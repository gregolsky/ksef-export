import { describe, it, expect } from 'vitest'
import { InvoicesDownloadedEventSchema, SinkEventSchema, ShutdownEventSchema } from '../src/events.js'

const validDownloaded = {
  event: 'InvoicesDownloaded',
  year: 2026,
  month: 4,
  files: [
    { subject: 'received', ref: 'REF-1', path: '2026/04/received/REF-1.pdf' },
    { subject: 'issued', ref: 'REF-2', path: '2026/04/issued/REF-2.pdf' },
  ],
}

describe('InvoicesDownloadedEventSchema', () => {
  it('accepts a valid event', () => {
    expect(InvoicesDownloadedEventSchema.safeParse(validDownloaded).success).toBe(true)
  })

  it('accepts empty files array', () => {
    expect(InvoicesDownloadedEventSchema.safeParse({ ...validDownloaded, files: [] }).success).toBe(true)
  })

  it('rejects unknown subject', () => {
    const bad = { ...validDownloaded, files: [{ subject: 'other', ref: 'x', path: 'x.pdf' }] }
    expect(InvoicesDownloadedEventSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects month < 1', () => {
    expect(InvoicesDownloadedEventSchema.safeParse({ ...validDownloaded, month: 0 }).success).toBe(false)
  })

  it('rejects month > 12', () => {
    expect(InvoicesDownloadedEventSchema.safeParse({ ...validDownloaded, month: 13 }).success).toBe(false)
  })
})

describe('ShutdownEventSchema', () => {
  it('accepts { event: "Shutdown" }', () => {
    expect(ShutdownEventSchema.safeParse({ event: 'Shutdown' }).success).toBe(true)
  })

  it('rejects other strings', () => {
    expect(ShutdownEventSchema.safeParse({ event: 'Stop' }).success).toBe(false)
  })
})

describe('SinkEventSchema', () => {
  it('accepts InvoicesDownloaded', () => {
    expect(SinkEventSchema.safeParse(validDownloaded).success).toBe(true)
  })

  it('accepts Shutdown', () => {
    expect(SinkEventSchema.safeParse({ event: 'Shutdown' }).success).toBe(true)
  })

  it('rejects unknown event', () => {
    expect(SinkEventSchema.safeParse({ event: 'Bogus' }).success).toBe(false)
  })
})
