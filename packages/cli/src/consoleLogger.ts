import type { Logger } from '@ksef2gdrive/core'

function ts(): string {
  return new Date().toISOString()
}

export const consoleLogger: Logger = {
  info: (msg) => console.log(`[${ts()}] INFO  ${msg}`),
  warn: (msg) => console.warn(`[${ts()}] WARN  ${msg}`),
  error: (msg) => console.error(`[${ts()}] ERROR ${msg}`),
  debug: (msg) => {
    if (process.env['DEBUG'] != null) {
      console.debug(`[${ts()}] DEBUG ${msg}`)
    }
  },
}
