import { z } from 'zod'
import type { Logger } from '../logger.js'
import { encryptKsefToken } from './crypto.js'

export type KsefEnv = 'prod' | 'test'

export interface KsefCredentials {
  token: string
  nip: string
  env: KsefEnv
}

export type SubjectType = 'received' | 'issued' | 'both'

export interface InvoiceRef {
  ksefReferenceNumber: string
  issuedBy: string
  issuedTo: string
  issueDate: string
}

function baseUrl(env: KsefEnv): string {
  return env === 'prod'
    ? 'https://api.ksef.mf.gov.pl/api/v2'
    : 'https://api-test.ksef.mf.gov.pl/api/v2'
}

const POLL_INTERVAL_MS = 2_000
const MAX_POLLS = 60

const ChallengeResponseSchema = z.object({
  challenge: z.string(),
  timestampMs: z.number(),
})

const PublicKeyResponseSchema = z.array(
  z.object({
    publicKey: z.string(),
  }),
)

const KsefTokenResponseSchema = z.object({
  referenceNumber: z.string(),
})

const AuthStatusSchema = z.object({
  processingCode: z.number(),
})

const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
})

const QueryResponseSchema = z.object({
  queryId: z.string(),
})

const QueryStatusSchema = z.object({
  processingCode: z.number(),
  numberOfParts: z.number().optional(),
})

const QueryPartSchema = z.object({
  invoiceHeaderList: z.array(
    z.object({
      ksefReferenceNumber: z.string(),
      invoiceHash: z.object({ hashSHA: z.object({ value: z.string() }) }).optional(),
    }),
  ).optional(),
  invoiceList: z.array(
    z.object({ ksefReferenceNumber: z.string() }),
  ).optional(),
})

export class KsefClient {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiresAt: number = 0

  constructor(
    private readonly creds: KsefCredentials,
    private readonly logger: Logger,
  ) {}

  private get base(): string {
    return baseUrl(this.creds.env)
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { binary?: boolean; auth?: boolean },
  ): Promise<T> {
    const url = `${this.base}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: options?.binary === true ? 'application/octet-stream' : 'application/json',
    }

    if (options?.auth !== false && this.accessToken !== null) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    let res: Response
    let attempt = 0
    const maxAttempts = 4

    const fetchInit: RequestInit = { method, headers }
    if (body !== undefined) {
      fetchInit.body = JSON.stringify(body)
    }

    while (true) {
      res = await fetch(url, fetchInit)

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        attempt++
        if (attempt >= maxAttempts) break
        const retryAfter = Number(res.headers.get('Retry-After') ?? '0')
        const delay = retryAfter > 0 ? retryAfter * 1_000 : Math.min(500 * 2 ** attempt, 30_000)
        this.logger.warn(`${method} ${path} → ${res.status}, retrying in ${delay}ms`)
        await sleep(delay)
        continue
      }
      break
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new KsefError(`KSeF ${method} ${path} failed: HTTP ${res.status} — ${text}`, res.status)
    }

    if (options?.binary === true) {
      const buf = await res.arrayBuffer()
      return Buffer.from(buf) as unknown as T
    }

    return res.json() as Promise<T>
  }

  async authenticate(): Promise<void> {
    this.logger.info('KSeF: starting token authentication')

    // Step 1: challenge
    const challengeRaw = await this.request<unknown>('POST', '/auth/challenge', {}, { auth: false })
    const { challenge: _challenge, timestampMs } = ChallengeResponseSchema.parse(challengeRaw)

    // Step 2: public key certificates
    const keysRaw = await this.request<unknown>('GET', '/security/public-key-certificates', undefined, { auth: false })
    const keys = PublicKeyResponseSchema.parse(keysRaw)
    if (keys.length === 0 || keys[0] == null) {
      throw new KsefError('No public key certificates returned by KSeF', 0)
    }
    const certBase64 = keys[0].publicKey

    // Step 3: encrypt token
    const signature = encryptKsefToken(this.creds.token, timestampMs, certBase64)

    // Step 4: submit ksef-token
    const submitRaw = await this.request<unknown>(
      'POST',
      '/auth/ksef-token',
      { nip: this.creds.nip, signature },
      { auth: false },
    )
    const { referenceNumber } = KsefTokenResponseSchema.parse(submitRaw)
    this.logger.debug(`KSeF: auth reference = ${referenceNumber}`)

    // Step 5: poll for auth completion
    await this.pollUntil(
      () => this.request<unknown>('GET', `/auth/${referenceNumber}`, undefined, { auth: false }),
      (raw) => {
        const { processingCode } = AuthStatusSchema.parse(raw)
        if (processingCode === 200) return true
        if (processingCode >= 400) throw new KsefError(`Auth failed, processingCode=${processingCode}`, processingCode)
        return false
      },
      'auth',
    )

    // Step 6: redeem tokens
    const tokenRaw = await this.request<unknown>(
      'POST',
      '/auth/token/redeem',
      { referenceNumber },
      { auth: false },
    )
    const { accessToken, refreshToken } = TokenPairSchema.parse(tokenRaw)
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    // Access tokens are short-lived (~15 min); schedule refresh 1 min before expiry
    this.tokenExpiresAt = Date.now() + 14 * 60 * 1_000
    this.logger.info('KSeF: authenticated successfully')
  }

  async ensureFreshToken(): Promise<void> {
    if (Date.now() < this.tokenExpiresAt) return
    if (this.refreshToken === null) {
      await this.authenticate()
      return
    }
    this.logger.debug('KSeF: refreshing access token')
    const raw = await this.request<unknown>('POST', '/auth/token/refresh', { refreshToken: this.refreshToken }, { auth: false })
    const { accessToken, refreshToken } = TokenPairSchema.parse(raw)
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    this.tokenExpiresAt = Date.now() + 14 * 60 * 1_000
  }

  async queryInvoices(
    from: string,
    to: string,
    subject: 'subject1' | 'subject2',
  ): Promise<InvoiceRef[]> {
    await this.ensureFreshToken()

    const label = subject === 'subject1' ? 'issued' : 'received'
    this.logger.info(`KSeF: querying ${label} invoices from ${from} to ${to}`)

    const queryRaw = await this.request<unknown>('POST', '/invoice/query', {
      subjectType: subject,
      dateRange: { from, to },
    })
    const { queryId } = QueryResponseSchema.parse(queryRaw)
    this.logger.debug(`KSeF: queryId = ${queryId}`)

    // Poll until done
    let numberOfParts = 0
    await this.pollUntil(
      () => this.request<unknown>('GET', `/query/${queryId}/status`),
      (raw) => {
        const status = QueryStatusSchema.parse(raw)
        if (status.processingCode === 200) {
          numberOfParts = status.numberOfParts ?? 0
          return true
        }
        if (status.processingCode >= 400) {
          throw new KsefError(`Query failed, processingCode=${status.processingCode}`, status.processingCode)
        }
        return false
      },
      'query',
    )

    this.logger.info(`KSeF: query done, ${numberOfParts} part(s)`)

    const refs: InvoiceRef[] = []
    for (let i = 0; i < numberOfParts; i++) {
      const partRaw = await this.request<unknown>('GET', `/query/${queryId}/result/${i}`)
      const part = QueryPartSchema.parse(partRaw)
      const list = part.invoiceHeaderList ?? part.invoiceList ?? []
      for (const inv of list) {
        refs.push({
          ksefReferenceNumber: inv.ksefReferenceNumber,
          issuedBy: '',
          issuedTo: '',
          issueDate: '',
        })
      }
    }

    this.logger.info(`KSeF: ${refs.length} ${label} invoices found`)
    return refs
  }

  async visualizeInvoice(ksefReferenceNumber: string): Promise<Buffer> {
    await this.ensureFreshToken()
    const pdf = await this.request<Buffer>(
      'POST',
      '/invoice/visualize',
      { ksefReferenceNumber, format: 'Pdf', language: 'pl' },
      { binary: true },
    )
    return pdf
  }

  private async pollUntil(
    fn: () => Promise<unknown>,
    check: (raw: unknown) => boolean,
    label: string,
  ): Promise<void> {
    for (let i = 0; i < MAX_POLLS; i++) {
      const raw = await fn()
      if (check(raw)) return
      await sleep(POLL_INTERVAL_MS)
    }
    throw new KsefError(`KSeF: timed out polling for ${label}`, 0)
  }
}

export class KsefError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message)
    this.name = 'KsefError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
