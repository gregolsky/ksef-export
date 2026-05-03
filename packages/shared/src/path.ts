export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_')
}

export function formatSubdir(fmt: string, year: number, month: number): string {
  return fmt
    .replace('{year}', String(year))
    .replace('{month}', String(month).padStart(2, '0'))
}

export function invoicePath(
  year: number,
  month: number,
  subject: 'received' | 'issued',
  ref: string,
): string {
  const mm = String(month).padStart(2, '0')
  return `${year}/${mm}/${subject}/${sanitizeFilename(ref)}.pdf`
}
