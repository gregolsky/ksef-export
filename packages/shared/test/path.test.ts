import { describe, it, expect } from 'vitest'
import { sanitizeFilename, formatSubdir, invoicePath } from '../src/path.js'

describe('sanitizeFilename', () => {
  it('replaces forbidden characters with underscores', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('leaves safe characters unchanged', () => {
    expect(sanitizeFilename('20260401-EE-ABCD1234')).toBe('20260401-EE-ABCD1234')
  })
})

describe('formatSubdir', () => {
  it('replaces {year} and {month} tokens', () => {
    expect(formatSubdir('{year}/{month}', 2026, 4)).toBe('2026/04')
  })

  it('zero-pads single-digit month', () => {
    expect(formatSubdir('{year}/{month}', 2026, 1)).toBe('2026/01')
  })

  it('supports custom separator', () => {
    expect(formatSubdir('{year}-{month}', 2026, 11)).toBe('2026-11')
  })
})

describe('invoicePath', () => {
  it('builds the correct relative path for received', () => {
    expect(invoicePath(2026, 4, 'received', 'REF-123')).toBe('2026/04/received/REF-123.pdf')
  })

  it('builds the correct relative path for issued', () => {
    expect(invoicePath(2026, 4, 'issued', 'REF-456')).toBe('2026/04/issued/REF-456.pdf')
  })

  it('sanitizes the ref in the filename', () => {
    expect(invoicePath(2026, 4, 'received', 'REF/456')).toBe('2026/04/received/REF_456.pdf')
  })

  it('zero-pads the month', () => {
    expect(invoicePath(2026, 1, 'issued', 'REF')).toBe('2026/01/issued/REF.pdf')
  })
})
