import { readFile } from 'node:fs/promises'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

// Service accounts need drive scope (not drive.file) because drive.file only
// covers files the SA itself created, not folders shared with it by a user.
const SCOPES = ['https://www.googleapis.com/auth/drive']

export async function getServiceAccountClient(keyFilePath: string): Promise<OAuth2Client> {
  const raw = await readFile(keyFilePath, 'utf8')
  const key = JSON.parse(raw) as object

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: SCOPES,
  })

  // GoogleAuth is compatible with the OAuth2Client interface expected by googleapis
  return auth.getClient() as Promise<OAuth2Client>
}
