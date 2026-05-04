import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { noopLogger } from '@ksef-export/shared'
import type { InvoicesDownloadedEvent } from '@ksef-export/shared'

const fakeDrive = {
  files: {
    list: vi.fn(),
    create: vi.fn(),
  },
}

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => fakeDrive),
  },
}))

const { handleInvoicesDownloaded } = await import('../src/uploader.js')

const uploaderConfig = (inboxPath: string) => ({
  inboxPath,
  gdriveRootName: 'Invoices',
  gdriveParentId: 'root',
  monthSubdirFormat: '{year}/{month}',
  sinkMarker: '.gdrive-synced',
  logger: noopLogger,
})

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'uploader-test-'))
  fakeDrive.files.list.mockReset()
  fakeDrive.files.create.mockReset()
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function seedFolder(listResults: { id: string }[][]) {
  for (const r of listResults) {
    fakeDrive.files.list.mockResolvedValueOnce({ data: { files: r } })
  }
}

describe('handleInvoicesDownloaded', () => {
  it('builds folder hierarchy and uploads all files', async () => {
    // Seed: inbox/2026/04/received/REF-1.pdf
    const dir = join(tmpDir, '2026/04/received')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'REF-1.pdf'), '%PDF')

    // Folder lookups: Invoices, 2026, 04, received — all new
    fakeDrive.files.list.mockResolvedValue({ data: { files: [] } })
    fakeDrive.files.create
      .mockResolvedValueOnce({ data: { id: 'root-id' } })    // Invoices
      .mockResolvedValueOnce({ data: { id: 'year-id' } })    // 2026
      .mockResolvedValueOnce({ data: { id: 'month-id' } })   // 04
      .mockResolvedValueOnce({ data: { id: 'subj-id' } })    // received
      .mockResolvedValueOnce({ data: { id: 'file-id' } })    // the PDF

    const event: InvoicesDownloadedEvent = {
      event: 'InvoicesDownloaded',
      year: 2026,
      month: 4,
      files: [{ subject: 'received', ref: 'REF-1', path: '2026/04/received/REF-1.pdf' }],
    }

    const result = await handleInvoicesDownloaded(event, {} as never, uploaderConfig(tmpDir))

    expect(result.uploaded).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.files[0]?.status).toBe('uploaded')
  })

  it('reports skipped when file already exists in Drive', async () => {
    const dir = join(tmpDir, '2026/04/received')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'REF-1.pdf'), '%PDF')

    // Folder lookups succeed
    fakeDrive.files.list
      .mockResolvedValueOnce({ data: { files: [{ id: 'root-id' }] } }) // Invoices
      .mockResolvedValueOnce({ data: { files: [{ id: 'year-id' }] } }) // 2026
      .mockResolvedValueOnce({ data: { files: [{ id: 'month-id' }] } }) // 04
      .mockResolvedValueOnce({ data: { files: [{ id: 'subj-id' }] } }) // received
      .mockResolvedValueOnce({ data: { files: [{ id: 'file-id' }] } }) // file exists

    const event: InvoicesDownloadedEvent = {
      event: 'InvoicesDownloaded',
      year: 2026,
      month: 4,
      files: [{ subject: 'received', ref: 'REF-1', path: '2026/04/received/REF-1.pdf' }],
    }

    const result = await handleInvoicesDownloaded(event, {} as never, uploaderConfig(tmpDir))

    expect(result.skipped).toBe(1)
    expect(result.uploaded).toBe(0)
  })

  it('writes sync marker only when no files failed', async () => {
    const dir = join(tmpDir, '2026/04/received')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'REF-1.pdf'), '%PDF')

    fakeDrive.files.list.mockResolvedValue({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'some-id' } })

    const event: InvoicesDownloadedEvent = {
      event: 'InvoicesDownloaded',
      year: 2026,
      month: 4,
      files: [{ subject: 'received', ref: 'REF-1', path: '2026/04/received/REF-1.pdf' }],
    }

    await handleInvoicesDownloaded(event, {} as never, uploaderConfig(tmpDir))

    const markerPath = join(tmpDir, '2026/04/.gdrive-synced')
    await expect(access(markerPath)).resolves.toBeUndefined()
  })

  it('does not write sync marker when a file fails', async () => {
    // PDF does not exist on disk → will throw when readFile is called
    const event: InvoicesDownloadedEvent = {
      event: 'InvoicesDownloaded',
      year: 2026,
      month: 4,
      files: [{ subject: 'received', ref: 'MISSING', path: '2026/04/received/MISSING.pdf' }],
    }

    fakeDrive.files.list.mockResolvedValue({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'some-id' } })

    const result = await handleInvoicesDownloaded(event, {} as never, uploaderConfig(tmpDir))

    expect(result.failed).toBe(1)
    const markerPath = join(tmpDir, '2026/04/.gdrive-synced')
    await expect(access(markerPath)).rejects.toThrow()
  })

  it('includes the file path in the error message when PDF is missing', async () => {
    const event: InvoicesDownloadedEvent = {
      event: 'InvoicesDownloaded',
      year: 2026,
      month: 4,
      files: [{ subject: 'received', ref: 'MISSING', path: '2026/04/received/MISSING.pdf' }],
    }

    fakeDrive.files.list.mockResolvedValue({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'some-id' } })

    const result = await handleInvoicesDownloaded(event, {} as never, uploaderConfig(tmpDir))

    expect(result.files[0]?.status).toBe('failed')
    expect(result.files[0]?.error).toContain('2026/04/received/MISSING.pdf')
  })

  it('handles empty files array gracefully', async () => {
    const event: InvoicesDownloadedEvent = {
      event: 'InvoicesDownloaded',
      year: 2026,
      month: 4,
      files: [],
    }

    fakeDrive.files.list.mockResolvedValue({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValue({ data: { id: 'id' } })

    const result = await handleInvoicesDownloaded(event, {} as never, uploaderConfig(tmpDir))
    expect(result.uploaded).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
  })
})
