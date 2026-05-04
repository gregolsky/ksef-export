import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sweepRetention } from '../src/retention.js'
import { noopLogger } from '@ksef-export/shared'

async function seed(inboxPath: string, year: number, month: number, markers: string[] = [], hasPdf = true) {
  const mm = String(month).padStart(2, '0')
  const dir = join(inboxPath, String(year), mm)
  await mkdir(dir, { recursive: true })
  if (hasPdf) {
    await writeFile(join(dir, 'REF.pdf'), 'dummy')
  }
  for (const m of markers) {
    await writeFile(join(dir, m), new Date().toISOString())
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('sweepRetention', () => {
  let tmpDir: string

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  const now = new Date('2026-03-01T00:00:00Z')

  it('deletes a directory past retention with all markers present', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retention-test-'))
    await seed(tmpDir, 2026, 1, ['.gdrive-synced'])

    await sweepRetention(tmpDir, 10, ['.gdrive-synced'], now, noopLogger)

    expect(await exists(join(tmpDir, '2026/01'))).toBe(false)
  })

  it('keeps a directory past retention when a marker is missing', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retention-test-'))
    await seed(tmpDir, 2026, 1) // no marker

    await sweepRetention(tmpDir, 10, ['.gdrive-synced'], now, noopLogger)

    expect(await exists(join(tmpDir, '2026/01'))).toBe(true)
  })

  it('keeps a directory within the retention window even with all markers', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retention-test-'))
    await seed(tmpDir, 2026, 2, ['.gdrive-synced']) // Feb ends 2026-02-28, +10 days = Mar 10

    await sweepRetention(tmpDir, 10, ['.gdrive-synced'], now, noopLogger)

    expect(await exists(join(tmpDir, '2026/02'))).toBe(true)
  })

  it('pure time-based mode (no expected markers) deletes on time alone', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retention-test-'))
    await seed(tmpDir, 2026, 1) // no marker, but we don't require any

    await sweepRetention(tmpDir, 10, [], now, noopLogger)

    expect(await exists(join(tmpDir, '2026/01'))).toBe(false)
  })

  it('does not delete non-year/month directories', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retention-test-'))
    const miscDir = join(tmpDir, 'some-other-dir')
    await mkdir(miscDir)
    await writeFile(join(miscDir, 'file.txt'), 'keep')

    await sweepRetention(tmpDir, 0, [], now, noopLogger)

    expect(await exists(miscDir)).toBe(true)
  })

  it('ignores directories with invalid month numbers (00, 13)', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retention-test-'))
    const yearPath = join(tmpDir, '2026')
    await mkdir(yearPath)
    // Create month dirs with out-of-range values
    const m00 = join(yearPath, '00')
    const m13 = join(yearPath, '13')
    await mkdir(m00)
    await mkdir(m13)
    await writeFile(join(m00, 'file.pdf'), 'dummy')
    await writeFile(join(m13, 'file.pdf'), 'dummy')

    await sweepRetention(tmpDir, 0, [], now, noopLogger)

    // Both should be untouched because MONTH_RE rejects them
    expect(await exists(m00)).toBe(true)
    expect(await exists(m13)).toBe(true)
  })

  it('removes the year directory when all its month dirs are swept', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retention-test-'))
    await seed(tmpDir, 2025, 11, ['.gdrive-synced'])
    await seed(tmpDir, 2025, 12, ['.gdrive-synced'])

    await sweepRetention(tmpDir, 10, ['.gdrive-synced'], now, noopLogger)

    expect(await exists(join(tmpDir, '2025'))).toBe(false)
  })
})
