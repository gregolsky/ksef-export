import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writePdfIfMissing } from '../src/inbox.js'

describe('writePdfIfMissing', () => {
  let tmpDir: string

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  })

  it('writes the file and returns true when it does not exist', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'inbox-test-'))
    const pdf = Buffer.from('%PDF-1.4 fake')
    const wrote = await writePdfIfMissing(tmpDir, '2026/04/received/REF-1.pdf', pdf)

    expect(wrote).toBe(true)
    const content = await readFile(join(tmpDir, '2026/04/received/REF-1.pdf'))
    expect(content).toEqual(pdf)
  })

  it('returns false without overwriting when the file already exists', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'inbox-test-'))
    const dirPath = join(tmpDir, '2026/04/received')
    await mkdir(dirPath, { recursive: true })

    const original = Buffer.from('original content')
    await writeFile(join(dirPath, 'REF-1.pdf'), original)

    const newPdf = Buffer.from('new content')
    const wrote = await writePdfIfMissing(tmpDir, '2026/04/received/REF-1.pdf', newPdf)

    expect(wrote).toBe(false)
    const content = await readFile(join(tmpDir, '2026/04/received/REF-1.pdf'))
    expect(content).toEqual(original)
  })

  it('creates intermediate directories', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'inbox-test-'))
    await writePdfIfMissing(tmpDir, 'a/b/c/deep.pdf', Buffer.from('x'))
    const content = await readFile(join(tmpDir, 'a/b/c/deep.pdf'))
    expect(content.toString()).toBe('x')
  })
})
