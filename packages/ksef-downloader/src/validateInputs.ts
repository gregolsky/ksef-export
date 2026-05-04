const NIP_RE = /^\d{10}$/

export function validateNip(nip: string): void {
  if (!NIP_RE.test(nip)) {
    throw new Error(`KSEF_NIP must be exactly 10 digits, got: "${nip}"`)
  }
}

export function validateSinkUrls(urls: string[]): void {
  for (const url of urls) {
    try {
      new URL(url)
    } catch {
      throw new Error(`Invalid sink URL: "${url}"`)
    }
  }
}
