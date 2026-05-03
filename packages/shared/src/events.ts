import { z } from 'zod'

export const InvoiceFileSchema = z.object({
  subject: z.enum(['received', 'issued']),
  ref: z.string(),
  path: z.string(),
})
export type InvoiceFile = z.infer<typeof InvoiceFileSchema>

export const InvoicesDownloadedEventSchema = z.object({
  event: z.literal('InvoicesDownloaded'),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  files: z.array(InvoiceFileSchema),
})
export type InvoicesDownloadedEvent = z.infer<typeof InvoicesDownloadedEventSchema>

export const ShutdownEventSchema = z.object({
  event: z.literal('Shutdown'),
})
export type ShutdownEvent = z.infer<typeof ShutdownEventSchema>

export const SinkEventSchema = z.discriminatedUnion('event', [
  InvoicesDownloadedEventSchema,
  ShutdownEventSchema,
])
export type SinkEvent = z.infer<typeof SinkEventSchema>

export interface SinkResult {
  uploaded: number
  skipped: number
  failed: number
  files: Array<{ ref: string; subject: string; status: 'uploaded' | 'skipped' | 'failed'; error?: string }>
}
