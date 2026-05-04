import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GoogleDriveClient } from './gdrive/client.js'
import { writeSyncMarker } from './marker.js'
import { formatSubdir, sanitizeFilename, type Logger, type InvoicesDownloadedEvent, type SinkResult } from '@ksef-export/shared'
import type { OAuth2Client } from 'google-auth-library'

export interface UploaderConfig {
  inboxPath: string
  gdriveRootName: string
  gdriveParentId: string
  monthSubdirFormat: string
  sinkMarker: string
  logger: Logger
}

export async function handleInvoicesDownloaded(
  event: InvoicesDownloadedEvent,
  auth: OAuth2Client,
  config: UploaderConfig,
): Promise<SinkResult> {
  const { year, month, files } = event
  const { inboxPath, gdriveRootName, gdriveParentId, monthSubdirFormat, sinkMarker, logger } = config

  const gdrive = new GoogleDriveClient(auth, logger)

  // Build the Drive folder hierarchy: root → year/month subdir parts
  const monthSubdir = formatSubdir(monthSubdirFormat, year, month)
  const subParts = monthSubdir.split('/').filter(Boolean)

  let baseParentId = gdriveParentId
  baseParentId = await gdrive.ensureFolder(gdriveRootName, baseParentId)
  for (const part of subParts) {
    baseParentId = await gdrive.ensureFolder(part, baseParentId)
  }

  // Track per-subject folder IDs
  const subjectFolderIds = new Map<string, string>()
  const getSubjectFolderId = async (subject: string): Promise<string> => {
    const existing = subjectFolderIds.get(subject)
    if (existing != null) return existing
    const id = await gdrive.ensureFolder(subject, baseParentId)
    subjectFolderIds.set(subject, id)
    return id
  }

  const resultFiles: SinkResult['files'] = []
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
    const localPath = join(inboxPath, file.path)
    const filename = `${sanitizeFilename(file.ref)}.pdf`
    const subjectFolderId = await getSubjectFolderId(file.subject)

    try {
      let pdf: Buffer
      try {
        pdf = await readFile(localPath)
      } catch (readErr) {
        const cause = readErr instanceof Error ? readErr.message : String(readErr)
        throw new Error(`Cannot read PDF at ${localPath}: ${cause}`, { cause: readErr })
      }
      const { uploaded: wasUploaded } = await gdrive.uploadPdfIfMissing(filename, pdf, subjectFolderId)
      if (wasUploaded) {
        uploaded++
        resultFiles.push({ ref: file.ref, subject: file.subject, status: 'uploaded' })
      } else {
        skipped++
        resultFiles.push({ ref: file.ref, subject: file.subject, status: 'skipped' })
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.error(`Failed to upload ${file.ref}: ${error}`)
      failed++
      resultFiles.push({ ref: file.ref, subject: file.subject, status: 'failed', error })
    }
  }

  if (failed === 0) {
    await writeSyncMarker(inboxPath, year, month, sinkMarker, new Date())
    logger.info(`GDrive: wrote sync marker ${sinkMarker} for ${year}/${String(month).padStart(2, '0')}`)
  }

  return { uploaded, skipped, failed, files: resultFiles }
}
