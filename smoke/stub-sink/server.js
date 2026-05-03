#!/usr/bin/env node
// Minimal sink stub — records POST /events to a log file and writes the configured marker.
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const PORT = parseInt(process.env.PORT ?? '8080', 10)
const SINK_NAME = process.env.SINK_NAME ?? 'stub'
const INBOX_PATH = process.env.INBOX_PATH ?? '/inbox'
const LOG_PATH = process.env.LOG_PATH ?? `/var/log/${SINK_NAME}-events.json`
const FORCE_FAIL = process.env.FORCE_FAIL === '1'

mkdirSync(dirname(LOG_PATH), { recursive: true })

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return json(res, { ok: true })
  }

  if (req.method === 'POST' && req.url === '/events') {
    if (FORCE_FAIL) {
      return json(res, { error: 'forced failure' }, 500)
    }

    const bodyStr = await readBody(req)
    let body
    try {
      body = JSON.parse(bodyStr)
    } catch {
      return json(res, { error: 'bad json' }, 400)
    }

    // Append to event log
    appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...body }) + '\n')
    console.log(`[stub-sink:${SINK_NAME}] received event: ${body.event}`)

    // Write sync marker for InvoicesDownloaded
    if (body.event === 'InvoicesDownloaded') {
      const { year, month } = body
      const mm = String(month).padStart(2, '0')
      const markerDir = join(INBOX_PATH, String(year), mm)
      const markerPath = join(markerDir, `.${SINK_NAME}-synced`)
      mkdirSync(markerDir, { recursive: true })
      writeFileSync(markerPath, new Date().toISOString())
      console.log(`[stub-sink:${SINK_NAME}] wrote marker: ${markerPath}`)
      return json(res, { uploaded: body.files?.length ?? 0, skipped: 0, failed: 0, files: [] })
    }

    if (body.event === 'Shutdown') {
      json(res, { ok: true })
      console.log(`[stub-sink:${SINK_NAME}] shutting down`)
      setImmediate(() => process.exit(0))
      return
    }

    return json(res, { ok: true })
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`[stub-sink:${SINK_NAME}] listening on :${PORT} (FORCE_FAIL=${FORCE_FAIL})`)
})
