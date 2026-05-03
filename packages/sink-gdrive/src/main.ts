import 'dotenv/config'
import { createEventServer } from './server.js'
import { getAuthenticatedClient } from './gdriveAuth.js'
import { getServiceAccountClient } from './gdriveServiceAccount.js'
import { consoleLogger } from './consoleLogger.js'
import type { OAuth2Client } from 'google-auth-library'

async function main(): Promise<void> {
  const port = parseInt(process.env['PORT'] ?? '8080', 10)
  const inboxPath = process.env['INBOX_PATH'] ?? '/inbox'
  const gdriveRootName = process.env['GDRIVE_ROOT'] ?? 'Invoices'
  const gdriveParentId = process.env['GDRIVE_PARENT_ID'] ?? 'root'
  const monthSubdirFormat = process.env['GDRIVE_SUBDIR'] ?? '{year}/{month}'
  const sinkMarker = process.env['SINK_MARKER'] ?? '.gdrive-synced'

  const auth = await buildDriveClient()

  const server = createEventServer({
    port,
    auth,
    uploaderConfig: {
      inboxPath,
      gdriveRootName,
      gdriveParentId,
      monthSubdirFormat,
      sinkMarker,
      logger: consoleLogger,
    },
    logger: consoleLogger,
  })

  server.listen(port, () => {
    consoleLogger.info(`sink-gdrive listening on :${port}`)
  })

  server.on('error', (err) => {
    consoleLogger.error(`Server error: ${err.message}`)
    process.exit(1)
  })
}

async function buildDriveClient(): Promise<OAuth2Client> {
  const saKeyPath = process.env['GOOGLE_SERVICE_ACCOUNT_KEY']
  const oauthSecretsPath = process.env['GOOGLE_OAUTH_CLIENT_SECRETS'] ?? '/secrets/google_client.json'
  const tokenCachePath = process.env['GOOGLE_TOKEN_CACHE'] ?? '/data/gdrive_token.json'

  if (saKeyPath != null) {
    consoleLogger.info(`GDrive auth: service account (${saKeyPath})`)
    return getServiceAccountClient(saKeyPath)
  }

  consoleLogger.info(`GDrive auth: OAuth (${oauthSecretsPath})`)
  return getAuthenticatedClient(oauthSecretsPath, tokenCachePath)
}

main().catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
