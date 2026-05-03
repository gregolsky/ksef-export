import { createServer, type Server } from 'node:http'
import { SinkEventSchema } from '@ksef-export/shared'
import { handleInvoicesDownloaded, type UploaderConfig } from './uploader.js'
import type { OAuth2Client } from 'google-auth-library'
import type { Logger } from '@ksef-export/shared'

export interface ServerConfig {
  port: number
  uploaderConfig: UploaderConfig
  auth: OAuth2Client
  logger: Logger
}

export function createEventServer(cfg: ServerConfig): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method === 'POST' && req.url === '/events') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        let parsed: unknown
        try {
          parsed = JSON.parse(body)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
          return
        }

        const result = SinkEventSchema.safeParse(parsed)
        if (!result.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unknown or invalid event', issues: result.error.issues }))
          return
        }

        const event = result.data

        if (event.event === 'Shutdown') {
          cfg.logger.info('Received Shutdown event — draining and exiting')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          // Allow response to flush before shutting down
          setImmediate(() => {
            server.close(() => process.exit(0))
          })
          return
        }

        // InvoicesDownloaded
        handleInvoicesDownloaded(event, cfg.auth, cfg.uploaderConfig)
          .then((syncResult) => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(syncResult))
          })
          .catch((err: unknown) => {
            cfg.logger.error(`Event handler error: ${err instanceof Error ? err.message : String(err)}`)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          })
        return
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  return server
}
