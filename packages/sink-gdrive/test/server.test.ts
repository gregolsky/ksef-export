import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { noopLogger } from '@ksef-export/shared'

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      files: { list: vi.fn().mockResolvedValue({ data: { files: [] } }), create: vi.fn().mockResolvedValue({ data: { id: 'id' } }) },
    })),
  },
}))

vi.mock('../src/uploader.js', () => ({
  handleInvoicesDownloaded: vi.fn().mockResolvedValue({ uploaded: 1, skipped: 0, failed: 0, files: [] }),
}))

const { createEventServer } = await import('../src/server.js')
const { handleInvoicesDownloaded } = await import('../src/uploader.js')

const mockedHandle = handleInvoicesDownloaded as ReturnType<typeof vi.fn>

function makeServer() {
  return createEventServer({
    port: 0,
    auth: {} as never,
    uploaderConfig: {
      inboxPath: '/tmp/inbox',
      gdriveRootName: 'Invoices',
      gdriveParentId: 'root',
      monthSubdirFormat: '{year}/{month}',
      sinkMarker: '.gdrive-synced',
      logger: noopLogger,
    },
    logger: noopLogger,
  })
}

async function request(
  server: ReturnType<typeof createServer>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const port = (server.address() as { port: number }).port
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: body != null ? { 'Content-Type': 'application/json' } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

describe('createEventServer', () => {
  afterEach(() => {
    mockedHandle.mockReset()
    mockedHandle.mockResolvedValue({ uploaded: 1, skipped: 0, failed: 0, files: [] })
  })

  it('GET /healthz returns 200', async () => {
    const server = makeServer()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    try {
      const { status } = await request(server, 'GET', '/healthz')
      expect(status).toBe(200)
    } finally {
      server.close()
    }
  })

  it('POST /events with valid InvoicesDownloaded returns 200 and sync result', async () => {
    const server = makeServer()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    try {
      const { status, body } = await request(server, 'POST', '/events', {
        event: 'InvoicesDownloaded',
        year: 2026,
        month: 4,
        files: [],
      })
      expect(status).toBe(200)
      expect((body as { uploaded: number }).uploaded).toBe(1)
    } finally {
      server.close()
    }
  })

  it('POST /events with invalid body returns 400', async () => {
    const server = makeServer()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    try {
      const { status } = await request(server, 'POST', '/events', { event: 'Bogus' })
      expect(status).toBe(400)
    } finally {
      server.close()
    }
  })

  it('POST /events with malformed JSON returns 400', async () => {
    const server = makeServer()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const port = (server.address() as { port: number }).port
    try {
      const res = await fetch(`http://localhost:${port}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
      expect(res.status).toBe(400)
    } finally {
      server.close()
    }
  })
})
