import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { noopLogger } from '@ksef-export/shared'

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
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
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

describe('GoogleDriveClient retry', () => {
  it('retries on 500 and succeeds on second attempt', async () => {
    const serverErr = Object.assign(new Error('server error'), { response: { status: 500 } })
    fakeDrive.files.list
      .mockRejectedValueOnce(serverErr)
      .mockResolvedValueOnce({ data: { files: [{ id: 'retry-id', name: 'Invoices' }] } })

    const client = makeClient()
    const listPromise = client.ensureFolder('Invoices', 'root')
    await vi.runAllTimersAsync()

    expect(await listPromise).toBe('retry-id')
    expect(fakeDrive.files.list).toHaveBeenCalledTimes(2)
  })

  it('retries on 429 and succeeds on second attempt', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { response: { status: 429 } })
    fakeDrive.files.list
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce({ data: { files: [] } })
    fakeDrive.files.create.mockResolvedValueOnce({ data: { id: 'new-id' } })

    const client = makeClient()
    const folderPromise = client.ensureFolder('Invoices', 'root')
    await vi.runAllTimersAsync()

    expect(await folderPromise).toBe('new-id')
    expect(fakeDrive.files.list).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting all 4 attempts', async () => {
    const serverErr = Object.assign(new Error('always fails'), { response: { status: 503 } })
    fakeDrive.files.list
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr)

    const client = makeClient()
    const folderPromise = client.ensureFolder('Invoices', 'root')
    // Attach rejection handler before advancing timers so Node never sees it as unhandled
    const assertion = expect(folderPromise).rejects.toThrow('always fails')
    await vi.runAllTimersAsync()
    await assertion

    expect(fakeDrive.files.list).toHaveBeenCalledTimes(4)
  })

  it('does not retry on 404', async () => {
    const notFoundErr = Object.assign(new Error('not found'), { response: { status: 404 } })
    fakeDrive.files.list.mockRejectedValueOnce(notFoundErr)

    const client = makeClient()
    await expect(client.ensureFolder('Invoices', 'root')).rejects.toThrow('not found')
    expect(fakeDrive.files.list).toHaveBeenCalledTimes(1)
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
