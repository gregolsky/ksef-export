import { describe, it, expect } from 'vitest'
import { monthBounds } from '../src/time.js'

describe('monthBounds', () => {
  it('April 2026 starts on the 1st and ends on the 30th', () => {
    const { from, to } = monthBounds(2026, 4)
    expect(from).toBe('2026-04-01T00:00:00.000Z')
    expect(to).toBe('2026-04-30T23:59:59.999Z')
  })

  it('February 2024 (leap year) ends on the 29th', () => {
    const { from, to } = monthBounds(2024, 2)
    expect(from).toBe('2024-02-01T00:00:00.000Z')
    expect(to).toBe('2024-02-29T23:59:59.999Z')
  })

  it('February 2023 (non-leap year) ends on the 28th', () => {
    const { to } = monthBounds(2023, 2)
    expect(to).toBe('2023-02-28T23:59:59.999Z')
  })

  it('December does not roll over the year', () => {
    const { from, to } = monthBounds(2025, 12)
    expect(from).toBe('2025-12-01T00:00:00.000Z')
    expect(to).toBe('2025-12-31T23:59:59.999Z')
  })

  it('January starts correctly', () => {
    const { from } = monthBounds(2026, 1)
    expect(from).toBe('2026-01-01T00:00:00.000Z')
  })
})
