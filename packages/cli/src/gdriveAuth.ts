import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname } from 'node:path'
import { google } from 'googleapis'
import type { OAuth2Client, Credentials } from 'google-auth-library'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']

interface ClientSecrets {
  installed?: ClientSecretsInner
  web?: ClientSecretsInner
}

interface ClientSecretsInner {
  client_id: string
  client_secret: string
  redirect_uris: string[]
}

export async function getAuthenticatedClient(
  clientSecretsPath: string,
  tokenCachePath: string,
): Promise<OAuth2Client> {
  const secretsRaw = await readFile(clientSecretsPath, 'utf8')
  const secrets: ClientSecrets = JSON.parse(secretsRaw) as ClientSecrets
  const creds = secrets.installed ?? secrets.web
  if (creds == null) {
    throw new Error(`Invalid client secrets file at ${clientSecretsPath}`)
  }

  const redirectUri = creds.redirect_uris.includes('urn:ietf:wg:oauth:2.0:oob')
    ? 'urn:ietf:wg:oauth:2.0:oob'
    : (creds.redirect_uris[0] ?? 'http://localhost')

  const oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri)

  // Try to load cached token
  if (existsSync(tokenCachePath)) {
    const tokenRaw = await readFile(tokenCachePath, 'utf8')
    const token: Credentials = JSON.parse(tokenRaw) as Credentials
    oauth2Client.setCredentials(token)

    // Refresh if expired
    if (isExpired(token)) {
      await oauth2Client.refreshAccessToken()
      await persistToken(oauth2Client, tokenCachePath)
    }

    return oauth2Client
  }

  // First-run: interactive console OAuth flow
  const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES })
  console.log('\n--- Google Drive Authorization ---')
  console.log('Open this URL in your browser, authorize, then paste the code below:\n')
  console.log(authUrl)
  console.log()

  const code = await promptLine('Enter authorization code: ')
  const { tokens } = await oauth2Client.getToken(code.trim())
  oauth2Client.setCredentials(tokens)
  await persistToken(oauth2Client, tokenCachePath)

  console.log('Authorization successful. Token saved.\n')
  return oauth2Client
}

async function persistToken(client: OAuth2Client, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(client.credentials, null, 2), 'utf8')
}

function isExpired(token: Credentials): boolean {
  if (token.expiry_date == null) return false
  return Date.now() >= token.expiry_date - 60_000
}

function promptLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}
