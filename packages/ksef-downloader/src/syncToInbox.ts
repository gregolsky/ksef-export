import { KsefClient, type KsefCredentials } from './ksef/client.js'
import { writePdfIfMissing } from './inbox.js'
import { monthBounds, invoicePath, type Logger } from '@ksef2gdrive/shared'
import type { InvoiceFile } from '@ksef2gdrive/shared'

export interface SyncToInboxOptions {
  subject: 'both' | 'received' | 'issued'
  inboxPath: string
  logger: Logger
}

export async function syncToInbox(
  creds: KsefCredentials,
  year: number,
  month: number,
  options: SyncToInboxOptions,
): Promise<InvoiceFile[]> {
  const { inboxPath, logger } = options
  const ksef = new KsefClient(creds, logger)
  await ksef.authenticate()

  const { from, to } = monthBounds(year, month)
  logger.info(`Downloading: ${year}/${String(month).padStart(2, '0')}, range ${from} → ${to}`)

  const subjects: Array<{ key: 'received' | 'issued'; api: 'subject1' | 'subject2' }> = []
  if (options.subject === 'both' || options.subject === 'issued') {
    subjects.push({ key: 'issued', api: 'subject1' })
  }
  if (options.subject === 'both' || options.subject === 'received') {
    subjects.push({ key: 'received', api: 'subject2' })
  }

  const files: InvoiceFile[] = []

  for (const { key, api } of subjects) {
    const invoices = await ksef.queryInvoices(from, to, api)
    for (const inv of invoices) {
      const ref = inv.ksefReferenceNumber
      const relPath = invoicePath(year, month, key, ref)
      const pdf = await ksef.visualizeInvoice(ref)
      const wrote = await writePdfIfMissing(inboxPath, relPath, pdf)
      if (wrote) {
        logger.info(`Downloaded: ${relPath}`)
      } else {
        logger.debug(`Already on disk: ${relPath}`)
      }
      files.push({ subject: key, ref, path: relPath })
    }
  }

  logger.info(`Download complete: ${files.length} invoice(s)`)
  return files
}
