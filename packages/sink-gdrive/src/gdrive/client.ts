import { Readable } from 'node:stream'
import { google, type drive_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { Logger } from '@ksef-export/shared'

export class GoogleDriveClient {
  private drive: drive_v3.Drive

  constructor(
    private readonly auth: OAuth2Client,
    private readonly logger: Logger,
  ) {
    this.drive = google.drive({ version: 'v3', auth })
  }

  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 4
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn()
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status
        if ((status === 429 || (status != null && status >= 500)) && attempt + 1 < maxAttempts) {
          const delay = Math.min(500 * 2 ** (attempt + 1), 30_000)
          this.logger.warn(`GDrive: ${label} → ${status}, retrying in ${delay}ms`)
          await sleep(delay)
          continue
        }
        throw err
      }
    }
  }

  async ensureFolder(name: string, parentId = 'root'): Promise<string> {
    const q = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      `trashed = false`,
    ].join(' and ')

    const res = await this.withRetry('files.list', () => this.drive.files.list({
      q,
      fields: 'files(id, name)',
      spaces: 'drive',
    }))

    const existing = res.data.files?.[0]
    if (existing?.id != null) {
      return existing.id
    }

    this.logger.info(`GDrive: creating folder "${name}" under ${parentId}`)
    const created = await this.withRetry('files.create', () => this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    }))

    const id = created.data.id
    if (id == null) throw new Error(`GDrive: folder creation returned no ID for "${name}"`)
    return id
  }

  async uploadPdfIfMissing(
    filename: string,
    pdf: Buffer,
    parentId: string,
  ): Promise<{ uploaded: boolean }> {
    const q = [
      `name = '${filename.replace(/'/g, "\\'")}'`,
      `'${parentId}' in parents`,
      `trashed = false`,
    ].join(' and ')

    const res = await this.withRetry('files.list', () => this.drive.files.list({
      q,
      fields: 'files(id)',
      spaces: 'drive',
    }))

    if ((res.data.files?.length ?? 0) > 0) {
      this.logger.debug(`GDrive: skipping "${filename}" (already exists)`)
      return { uploaded: false }
    }

    this.logger.info(`GDrive: uploading "${filename}"`)
    await this.withRetry('files.create', () => this.drive.files.create(
      {
        requestBody: {
          name: filename,
          parents: [parentId],
        },
        media: {
          mimeType: 'application/pdf',
          body: bufferToReadable(pdf),
        },
        fields: 'id',
      },
      { responseType: 'json' },
    ))

    return { uploaded: true }
  }
}

function bufferToReadable(buf: Buffer): Readable {
  const r = new Readable()
  r.push(buf)
  r.push(null)
  return r
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
