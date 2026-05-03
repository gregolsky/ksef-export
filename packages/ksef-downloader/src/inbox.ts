import { writeFile, mkdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export async function writePdfIfMissing(
  inboxPath: string,
  relPath: string,
  pdf: Buffer,
): Promise<boolean> {
  const fullPath = join(inboxPath, relPath)

  try {
    await access(fullPath)
    return false // already exists
  } catch {
    // doesn't exist — write it
  }

  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, pdf)
  return true
}
