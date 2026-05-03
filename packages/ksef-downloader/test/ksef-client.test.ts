import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { KsefClient, KsefError } from '../src/ksef/client.js'
import { noopLogger } from '@ksef2gdrive/shared'
import { jsonResponse, binaryResponse } from './helpers.js'

function makeCertBase64(): string {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return (publicKey as Buffer).toString('base64')
}

const certBase64 = makeCertBase64()

function makeClient() {
  return new KsefClient({ token: 'test-token', nip: '1234567890', env: 'test' }, noopLogger)
}

function mockFetch() {
  const fn = vi.fn()
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function authenticate(client: KsefClient, fetch: ReturnType<typeof vi.fn>) {
  fetch
    .mockResolvedValueOnce(jsonResponse({ challenge: 'ch', timestampMs: 1700000000000 }))
    .mockResolvedValueOnce(jsonResponse([{ publicKey: certBase64 }]))
    .mockResolvedValueOnce(jsonResponse({ referenceNumber: 'ref-1' }))
    .mockResolvedValueOnce(jsonResponse({ processingCode: 200 }))
    .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-tok', refreshToken: 'refresh-tok' }))
  await client.authenticate()
}

describe('KsefClient', () => {
  describe('authenticate', () => {
    it('completes the full 5-step auth flow', async () => {
      const f = mockFetch()
      const client = makeClient()
      await authenticate(client, f)

      expect(f).toHaveBeenCalledTimes(5)
      const urls = f.mock.calls.map((c: unknown[]) => (c[0] as string).split('/api/v2')[1])
      expect(urls).toEqual([
        '/auth/challenge',
        '/security/public-key-certificates',
        '/auth/ksef-token',
        '/auth/ref-1',
        '/auth/token/redeem',
      ])
    })

    it('does not send Authorization header during auth flow', async () => {
      const f = mockFetch()
      const client = makeClient()
      await authenticate(client, f)

      for (const call of f.mock.calls as unknown[][]) {
        const init = call[1] as RequestInit
        const headers = init?.headers as Record<string, string> | undefined
        expect(headers?.['Authorization']).toBeUndefined()
      }
    })

    it('retries on 5xx and succeeds on second attempt', async () => {
      const f = mockFetch()
      const client = makeClient()

      f
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({ challenge: 'ch', timestampMs: 1700000000000 }))
        .mockResolvedValueOnce(jsonResponse([{ publicKey: certBase64 }]))
        .mockResolvedValueOnce(jsonResponse({ referenceNumber: 'ref-1' }))
        .mockResolvedValueOnce(jsonResponse({ processingCode: 200 }))
        .mockResolvedValueOnce(jsonResponse({ accessToken: 'tok', refreshToken: 'rtok' }))

      const authPromise = client.authenticate()
      await vi.runAllTimersAsync()
      await authPromise

      expect(f).toHaveBeenCalledTimes(6)
    })

    it('throws KsefError when processingCode >= 400', async () => {
      const f = mockFetch()
      const client = makeClient()

      f
        .mockResolvedValueOnce(jsonResponse({ challenge: 'ch', timestampMs: 1700000000000 }))
        .mockResolvedValueOnce(jsonResponse([{ publicKey: certBase64 }]))
        .mockResolvedValueOnce(jsonResponse({ referenceNumber: 'ref-1' }))
        .mockResolvedValueOnce(jsonResponse({ processingCode: 401 }))

      await expect(client.authenticate()).rejects.toThrow(KsefError)
    })

    it('throws KsefError immediately on non-retryable 4xx', async () => {
      const f = mockFetch()
      f.mockResolvedValueOnce(jsonResponse({ message: 'bad' }, 400))
      const client = makeClient()
      await expect(client.authenticate()).rejects.toThrow(KsefError)
      expect(f).toHaveBeenCalledTimes(1)
    })
  })

  describe('queryInvoices', () => {
    it('sends Authorization header on authenticated requests', async () => {
      const f = mockFetch()
      const client = makeClient()
      await authenticate(client, f)
      f.resetMock?.()
      f.mockClear()

      f
        .mockResolvedValueOnce(jsonResponse({ queryId: 'q1' }))
        .mockResolvedValueOnce(jsonResponse({ processingCode: 200, numberOfParts: 0 }))

      await client.queryInvoices('2026-04-01T00:00:00.000Z', '2026-04-30T23:59:59.999Z', 'subject1')

      const firstCall = f.mock.calls[0] as unknown[]
      const init = firstCall[1] as RequestInit
      const headers = init?.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer access-tok')
    })

    it('collects invoice refs from multiple parts', async () => {
      const f = mockFetch()
      const client = makeClient()
      await authenticate(client, f)
      f.mockClear()

      f
        .mockResolvedValueOnce(jsonResponse({ queryId: 'q1' }))
        .mockResolvedValueOnce(jsonResponse({ processingCode: 200, numberOfParts: 2 }))
        .mockResolvedValueOnce(jsonResponse({ invoiceHeaderList: [{ ksefReferenceNumber: 'REF-A' }] }))
        .mockResolvedValueOnce(jsonResponse({ invoiceHeaderList: [{ ksefReferenceNumber: 'REF-B' }] }))

      const refs = await client.queryInvoices('from', 'to', 'subject2')
      expect(refs.map((r) => r.ksefReferenceNumber)).toEqual(['REF-A', 'REF-B'])
    })

    it('retries token refresh when token expires', async () => {
      const f = mockFetch()
      const client = makeClient()
      await authenticate(client, f)
      f.mockClear()

      // Force token to appear expired
      ;(client as unknown as { tokenExpiresAt: number }).tokenExpiresAt = Date.now() - 1

      f
        .mockResolvedValueOnce(jsonResponse({ accessToken: 'new-tok', refreshToken: 'new-rtok' }))
        .mockResolvedValueOnce(jsonResponse({ queryId: 'q1' }))
        .mockResolvedValueOnce(jsonResponse({ processingCode: 200, numberOfParts: 0 }))

      await client.queryInvoices('from', 'to', 'subject1')

      const refreshUrl = (f.mock.calls[0] as unknown[])[0] as string
      expect(refreshUrl).toContain('/auth/token/refresh')

      const queryCall = f.mock.calls[1] as unknown[]
      const headers = (queryCall[1] as RequestInit).headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer new-tok')
    })
  })

  describe('visualizeInvoice', () => {
    it('returns a Buffer whose first 4 bytes are %PDF', async () => {
      const f = mockFetch()
      const client = makeClient()
      await authenticate(client, f)
      f.mockClear()

      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
      f.mockResolvedValueOnce(binaryResponse(pdfBytes))

      const buf = await client.visualizeInvoice('REF-1')
      expect(buf.subarray(0, 4)).toEqual(Buffer.from(pdfBytes))
    })
  })
})
