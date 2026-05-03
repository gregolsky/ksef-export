export function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}
