import type { InvoicesDownloadedEvent, SinkEvent, SinkResult, Logger } from '@ksef-export/shared'

export interface SinkOutcome {
  url: string
  ok: boolean
  result?: SinkResult
  error?: string
}

export async function emitToSinks(
  sinkUrls: string[],
  event: InvoicesDownloadedEvent,
  logger: Logger,
): Promise<{ allFailed: boolean; outcomes: SinkOutcome[] }> {
  if (sinkUrls.length === 0) {
    logger.warn('No SINK_URLS configured — skipping event emission')
    return { allFailed: false, outcomes: [] }
  }

  const results = await Promise.allSettled(
    sinkUrls.map((url) => postEvent(url, event)),
  )

  const outcomes: SinkOutcome[] = results.map((r, i) => {
    const url = sinkUrls[i] ?? ''
    if (r.status === 'fulfilled') {
      logger.info(`Sink ${url}: ${r.value.ok ? 'ok' : `failed (${r.value.error ?? 'unknown'})`}`)
      return r.value
    }
    const error = r.reason instanceof Error ? r.reason.message : String(r.reason)
    logger.error(`Sink ${url}: ${error}`)
    return { url, ok: false, error }
  })

  const allFailed = outcomes.length > 0 && outcomes.every((o) => !o.ok)
  return { allFailed, outcomes }
}

export async function shutdownSinks(
  sinkUrls: string[],
  logger: Logger,
): Promise<void> {
  if (sinkUrls.length === 0) return
  const results = await Promise.allSettled(
    sinkUrls.map((url) => postEvent(url, { event: 'Shutdown' })),
  )
  results.forEach((r, i) => {
    const url = sinkUrls[i] ?? ''
    if (r.status === 'rejected') {
      logger.warn(`Sink shutdown ${url}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    } else {
      logger.debug(`Sink shutdown ${url}: acknowledged`)
    }
  })
}

async function postEvent(url: string, event: SinkEvent): Promise<SinkOutcome> {
  let res: Response
  try {
    res = await fetch(`${url}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch (err) {
    return {
      url,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { url, ok: false, error: `HTTP ${res.status}: ${body}` }
  }

  const result = await res.json().catch(() => null) as SinkResult | null
  return { url, ok: true, result: result ?? undefined }
}
