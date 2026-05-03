import type { OAuth2Client } from 'google-auth-library'
import { KsefClient, type KsefCredentials } from './ksef/client.js'
import { GoogleDriveClient } from './gdrive/client.js'
import { monthBounds } from './time.js'
import { noopLogger, type Logger } from './logger.js'

export interface SyncOptions {
  subject: 'both' | 'received' | 'issued'
  gdriveRootName: string
  gdriveParentId: string
  monthSubdirFormat: string
  logger: Logger
}

const defaultOptions: SyncOptions = {
  subject: 'both',
  gdriveRootName: 'Invoices',
  gdriveParentId: 'root',
  monthSubdirFormat: '{year}/{month}',
  logger: noopLogger,
}

export interface SyncFileResult {
  ref: string
  subject: 'received' | 'issued'
  status: 'uploaded' | 'skipped' | 'failed'
  error?: string
}

export interface SyncResult {
  year: number
  month: number
  found: number
  uploaded: number
  skipped: number
  failed: number
  files: SyncFileResult[]
}

export async function syncMonth(args: {
  ksef: KsefCredentials
  drive: OAuth2Client
  year: number
  month: number
  options?: Partial<SyncOptions>
}): Promise<SyncResult> {
  const opts: SyncOptions = { ...defaultOptions, ...args.options }
  if (args.options?.logger !== undefined) {
    opts.logger = args.options.logger
  }

  const { year, month } = args
  const log = opts.logger

  const ksef = new KsefClient(args.ksef, log)
  const gdrive = new GoogleDriveClient(args.drive, log)

  await ksef.authenticate()

  const { from, to } = monthBounds(year, month)
  log.info(`Sync: month ${year}/${String(month).padStart(2, '0')}, range ${from} → ${to}`)

  // Resolve or create the folder hierarchy
  const monthSubdir = formatSubdir(opts.monthSubdirFormat, year, month)
  const subParts = monthSubdir.split('/').filter(Boolean)

  let currentParentId = opts.gdriveParentId
  currentParentId = await gdrive.ensureFolder(opts.gdriveRootName, currentParentId)
  for (const part of subParts) {
    currentParentId = await gdrive.ensureFolder(part, currentParentId)
  }

  const subjects: Array<{ key: 'received' | 'issued'; api: 'subject1' | 'subject2' }> = []
  if (opts.subject === 'both' || opts.subject === 'issued') {
    subjects.push({ key: 'issued', api: 'subject1' })
  }
  if (opts.subject === 'both' || opts.subject === 'received') {
    subjects.push({ key: 'received', api: 'subject2' })
  }

  const files: SyncFileResult[] = []

  for (const { key, api } of subjects) {
    const subFolderId = opts.subject === 'both'
      ? await gdrive.ensureFolder(key, currentParentId)
      : currentParentId

    const invoices = await ksef.queryInvoices(from, to, api)

    for (const inv of invoices) {
      const ref = inv.ksefReferenceNumber
      const filename = `${sanitizeFilename(ref)}.pdf`

      try {
        const pdf = await ksef.visualizeInvoice(ref)
        const { uploaded } = await gdrive.uploadPdfIfMissing(filename, pdf, subFolderId)

        files.push({
          ref,
          subject: key,
          status: uploaded ? 'uploaded' : 'skipped',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error(`Failed to process ${ref}: ${message}`)
        files.push({ ref, subject: key, status: 'failed', error: message })
      }
    }
  }

  const result: SyncResult = {
    year,
    month,
    found: files.length,
    uploaded: files.filter((f) => f.status === 'uploaded').length,
    skipped: files.filter((f) => f.status === 'skipped').length,
    failed: files.filter((f) => f.status === 'failed').length,
    files,
  }

  log.info(
    `Sync complete: ${result.found} found, ${result.uploaded} uploaded, ` +
    `${result.skipped} skipped, ${result.failed} failed`,
  )

  return result
}

function formatSubdir(fmt: string, year: number, month: number): string {
  return fmt
    .replace('{year}', String(year))
    .replace('{month}', String(month).padStart(2, '0'))
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_')
}
