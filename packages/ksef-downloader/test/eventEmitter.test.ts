import { describe, it, expect, vi, afterEach } from 'vitest'
import { emitToSinks, shutdownSinks } from '../src/eventEmitter.js'
import { noopLogger } from '@ksef-export/shared'
import { jsonResponse } from './helpers.js'
import type { InvoicesDownloadedEvent } from '@ksef-export/shared'

const sampleEvent: InvoicesDownloadedEvent = {
  event: 'InvoicesDownloaded',
  year: 2026,
  month: 4,
  files: [{ subject: 'received', ref: 'REF-1', path: '2026/04/received/REF-1.pdf' }],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('emitToSinks', () => {
  it('returns allFailed: false and empty outcomes when no sinks configured', async () => {
    const { allFailed, outcomes } = await emitToSinks([], sampleEvent, noopLogger)
    expect(allFailed).toBe(false)
    expect(outcomes).toHaveLength(0)
  })

  it('fans out to multiple sinks in parallel', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ uploaded: 1, skipped: 0, failed: 0, files: [] }))
      .mockResolvedValueOnce(jsonResponse({ uploaded: 1, skipped: 0, failed: 0, files: [] }))
    vi.stubGlobal('fetch', f)

    const { allFailed, outcomes } = await emitToSinks(
      ['http://sink-a:8080', 'http://sink-b:8080'],
      sampleEvent,
      noopLogger,
    )

    expect(allFailed).toBe(false)
    expect(outcomes).toHaveLength(2)
    expect(outcomes.every((o) => o.ok)).toBe(true)

    const urls = f.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(urls).toContain('http://sink-a:8080/events')
    expect(urls).toContain('http://sink-b:8080/events')
  })

  it('returns allFailed: false when at least one sink succeeds', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ uploaded: 1, skipped: 0, failed: 0, files: [] }))
    vi.stubGlobal('fetch', f)

    const { allFailed, outcomes } = await emitToSinks(
      ['http://bad:8080', 'http://good:8080'],
      sampleEvent,
      noopLogger,
    )

    expect(allFailed).toBe(false)
    expect(outcomes[0]?.ok).toBe(false)
    expect(outcomes[1]?.ok).toBe(true)
  })

  it('returns allFailed: true when every sink fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))

    const { allFailed } = await emitToSinks(
      ['http://sink-a:8080', 'http://sink-b:8080'],
      sampleEvent,
      noopLogger,
    )

    expect(allFailed).toBe(true)
  })

  it('handles network errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const { allFailed, outcomes } = await emitToSinks(['http://down:8080'], sampleEvent, noopLogger)
    expect(allFailed).toBe(true)
    expect(outcomes[0]?.ok).toBe(false)
    expect(outcomes[0]?.error).toContain('ECONNREFUSED')
  })
})

describe('shutdownSinks', () => {
  it('POSTs Shutdown event to all sink URLs', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', f)

    await shutdownSinks(['http://sink-a:8080', 'http://sink-b:8080'], noopLogger)

    expect(f).toHaveBeenCalledTimes(2)
    const bodies = f.mock.calls.map((c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string))
    expect(bodies.every((b: { event: string }) => b.event === 'Shutdown')).toBe(true)
  })

  it('does nothing when sinkUrls is empty', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await shutdownSinks([], noopLogger)
    expect(f).not.toHaveBeenCalled()
  })
})
