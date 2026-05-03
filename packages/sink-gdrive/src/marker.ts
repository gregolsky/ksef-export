import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export async function writeSyncMarker(
  inboxPath: string,
  year: number,
  month: number,
  markerName: string,
  timestamp: Date,
): Promise<void> {
  const mm = String(month).padStart(2, '0')
  const markerPath = join(inboxPath, String(year), mm, markerName)
  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, timestamp.toISOString(), 'utf8')
}
