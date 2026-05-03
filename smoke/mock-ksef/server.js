#!/usr/bin/env node
// Minimal KSeF v2 mock — serves canned responses so ksef-downloader can run without real KSeF.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'

const PORT = parseInt(process.env.PORT ?? '8081', 10)
const FIXTURE_PATH = process.env.FIXTURE_PATH ?? '/fixtures/one-invoice.json'
// Which subject type queries should return invoices (subject1=issued, subject2=received, both=all)
const SUBJECT = process.env.SUBJECT ?? 'both'

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
const invoices = fixture.invoices ?? []

// Generate ephemeral keypair on startup
const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const certBase64 = publicKey.toString('base64')

let queryId = 'query-001'
let authRef = 'auth-ref-001'

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  const path = req.url ?? '/'

  if (path === '/api/v2/auth/challenge' && req.method === 'POST') {
    return json(res, { challenge: 'mock-challenge', timestampMs: Date.now() })
  }

  if (path === '/api/v2/security/public-key-certificates' && req.method === 'GET') {
    return json(res, [{ publicKey: certBase64 }])
  }

  if (path === '/api/v2/auth/ksef-token' && req.method === 'POST') {
    return json(res, { referenceNumber: authRef })
  }

  if (path === `/api/v2/auth/${authRef}` && req.method === 'GET') {
    return json(res, { processingCode: 200 })
  }

  if (path === '/api/v2/auth/token/redeem' && req.method === 'POST') {
    return json(res, { accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' })
  }

  if (path === '/api/v2/auth/token/refresh' && req.method === 'POST') {
    return json(res, { accessToken: 'mock-access-token-2', refreshToken: 'mock-refresh-token-2' })
  }

  if (path === '/api/v2/invoice/query' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const subject = body.subjectType
    // Return invoices based on subject filter
    const shouldReturn = SUBJECT === 'both' ||
      (SUBJECT === 'issued' && subject === 'subject1') ||
      (SUBJECT === 'received' && subject === 'subject2')

    const parts = shouldReturn && invoices.length > 0 ? 1 : 0
    const id = `${queryId}-${subject}`
    server._queryMap = server._queryMap ?? {}
    server._queryMap[id] = shouldReturn ? invoices : []
    return json(res, { queryId: id })
  }

  const queryStatusMatch = path.match(/^\/api\/v2\/query\/(.+)\/status$/)
  if (queryStatusMatch && req.method === 'GET') {
    const id = queryStatusMatch[1]
    const items = server._queryMap?.[id] ?? []
    return json(res, { processingCode: 200, numberOfParts: items.length > 0 ? 1 : 0 })
  }

  const queryResultMatch = path.match(/^\/api\/v2\/query\/(.+)\/result\/(\d+)$/)
  if (queryResultMatch && req.method === 'GET') {
    const id = queryResultMatch[1]
    const items = server._queryMap?.[id] ?? []
    return json(res, { invoiceHeaderList: items })
  }

  if (path === '/api/v2/invoice/visualize' && req.method === 'POST') {
    // Return a minimal PDF stub
    const pdfBytes = Buffer.from('%PDF-1.4 1 0 obj<</Type/Catalog>>endobj\n%%EOF')
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    return res.end(pdfBytes)
  }

  console.error(`[mock-ksef] 404: ${req.method} ${path}`)
  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`[mock-ksef] listening on :${PORT} (fixture: ${FIXTURE_PATH}, subject: ${SUBJECT})`)
})
