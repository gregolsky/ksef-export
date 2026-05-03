import { Readable } from 'node:stream'
import { google, type drive_v3 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { Logger } from '../logger.js'

export class GoogleDriveClient {
  private drive: drive_v3.Drive

  constructor(
    private readonly auth: OAuth2Client,
    private readonly logger: Logger,
  ) {
    this.drive = google.drive({ version: 'v3', auth })
  }

  /**
   * Returns the ID of a folder named `name` under `parentId`, creating it if absent.
   * `parentId` defaults to 'root' (My Drive).
   */
  async ensureFolder(name: string, parentId = 'root'): Promise<string> {
    const q = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      `trashed = false`,
    ].join(' and ')

    const res = await this.drive.files.list({
      q,
      fields: 'files(id, name)',
      spaces: 'drive',
    })

    const existing = res.data.files?.[0]
    if (existing?.id != null) {
      return existing.id
    }

    this.logger.info(`GDrive: creating folder "${name}" under ${parentId}`)
    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    })

    const id = created.data.id
    if (id == null) throw new Error(`GDrive: folder creation returned no ID for "${name}"`)
    return id
  }

  /**
   * Uploads `pdf` as `filename` under `parentId`. Skips if a file with that name already exists.
   * Returns `{ uploaded: true }` or `{ uploaded: false }`.
   */
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

    const res = await this.drive.files.list({
      q,
      fields: 'files(id)',
      spaces: 'drive',
    })

    if ((res.data.files?.length ?? 0) > 0) {
      this.logger.debug(`GDrive: skipping "${filename}" (already exists)`)
      return { uploaded: false }
    }

    this.logger.info(`GDrive: uploading "${filename}"`)
    await this.drive.files.create(
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
    )

    return { uploaded: true }
  }
}

function bufferToReadable(buf: Buffer): Readable {
  const r = new Readable()
  r.push(buf)
  r.push(null)
  return r
}
