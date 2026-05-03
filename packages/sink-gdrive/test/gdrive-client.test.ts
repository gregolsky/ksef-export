import { describe, it, expect, vi, beforeEach } from 'vitest'
import { noopLogger } from '@ksef2gdrive/shared'

// Stub googleapis before importing the client
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

const { GoogleDriveClient } = await import('../src/gdrive/client.js')

function makeClient() {
  return new GoogleDriveClient({} as never, noopLogger)
}

beforeEach(() => {
  fakeDrive.files.list.mockReset()
  fakeDrive.files.create.mockReset()
})

describe('GoogleDriveClient.ensureFolder', () => {
  it('returns existing ID without creating when folder exists', async () => {
    fakeDrive.files.list.mockResolvedValueOnce({ data: { files: [{ id: 'existing-id', name: 'Invoices' }] } })

    const client = makeClient()
    const id = await client.ensureFolder('Invoices', 'root')

    expect(id).toBe('existing-id')
    expect(fakeDrive.files.create).not.toHaveBeenCalled()
  })

  it('creates folder and returns new ID when not found', async () => {
    fakeDrive.files.list.mockResolvedValueOnce({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValueOnce({ data: { id: 'new-id' } })

    const client = makeClient()
    const id = await client.ensureFolder('Invoices', 'root')

    expect(id).toBe('new-id')
    expect(fakeDrive.files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          name: 'Invoices',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['root'],
        }),
      }),
    )
  })

  it("escapes single quotes in folder name in the query", async () => {
    fakeDrive.files.list.mockResolvedValueOnce({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValueOnce({ data: { id: 'id' } })

    const client = makeClient()
    await client.ensureFolder("O'Brien", 'root')

    const callArg = fakeDrive.files.list.mock.calls[0][0] as { q: string }
    expect(callArg.q).toContain("name = 'O\\'Brien'")
  })
})

describe('GoogleDriveClient.uploadPdfIfMissing', () => {
  it('skips upload and returns { uploaded: false } when file exists', async () => {
    fakeDrive.files.list.mockResolvedValueOnce({ data: { files: [{ id: 'file-id' }] } })

    const client = makeClient()
    const result = await client.uploadPdfIfMissing('invoice.pdf', Buffer.from('pdf'), 'parent-id')

    expect(result.uploaded).toBe(false)
    expect(fakeDrive.files.create).not.toHaveBeenCalled()
  })

  it('uploads and returns { uploaded: true } when file does not exist', async () => {
    fakeDrive.files.list.mockResolvedValueOnce({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValueOnce({ data: { id: 'new-file-id' } })

    const client = makeClient()
    const result = await client.uploadPdfIfMissing('invoice.pdf', Buffer.from('%PDF'), 'parent-id')

    expect(result.uploaded).toBe(true)
    expect(fakeDrive.files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ name: 'invoice.pdf', parents: ['parent-id'] }),
        media: expect.objectContaining({ mimeType: 'application/pdf' }),
      }),
      expect.any(Object),
    )
  })
})
