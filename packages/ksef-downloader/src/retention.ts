import { readdir, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@ksef2gdrive/shared'

const YEAR_RE = /^\d{4}$/
const MONTH_RE = /^\d{2}$/

export async function sweepRetention(
  inboxPath: string,
  retentionDays: number,
  expectedMarkers: string[],
  now: Date,
  logger: Logger,
): Promise<void> {
  let yearDirs: string[]
  try {
    yearDirs = await readdir(inboxPath)
  } catch {
    return // inbox doesn't exist yet
  }

  for (const yearDir of yearDirs) {
    if (!YEAR_RE.test(yearDir)) continue
    const yearPath = join(inboxPath, yearDir)

    let monthDirs: string[]
    try {
      monthDirs = await readdir(yearPath)
    } catch {
      continue
    }

    for (const monthDir of monthDirs) {
      if (!MONTH_RE.test(monthDir)) continue

      const year = parseInt(yearDir, 10)
      const month = parseInt(monthDir, 10)
      const monthPath = join(yearPath, monthDir)

      if (!isPastRetention(year, month, retentionDays, now)) continue

      if (expectedMarkers.length > 0) {
        const markersMissing = await missingMarkers(monthPath, expectedMarkers)
        if (markersMissing.length > 0) {
          logger.debug(`Retention: keeping ${yearDir}/${monthDir} — markers missing: ${markersMissing.join(', ')}`)
          continue
        }
      }

      logger.info(`Retention: deleting ${yearDir}/${monthDir}`)
      try {
        await rm(monthPath, { recursive: true, force: true })
        // remove year dir if now empty
        const remaining = await readdir(yearPath).catch(() => [])
        if (remaining.length === 0) {
          await rm(yearPath, { recursive: true, force: true })
        }
      } catch (err) {
        logger.warn(`Retention: failed to delete ${yearDir}/${monthDir}: ${String(err)}`)
      }
    }
  }
}

function isPastRetention(year: number, month: number, retentionDays: number, now: Date): boolean {
  // last second of the month
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  const cutoff = new Date(endOfMonth.getTime() + retentionDays * 86_400_000)
  return now >= cutoff
}

async function missingMarkers(dirPath: string, markers: string[]): Promise<string[]> {
  const missing: string[] = []
  for (const marker of markers) {
    try {
      await access(join(dirPath, marker))
    } catch {
      missing.push(marker)
    }
  }
  return missing
}
