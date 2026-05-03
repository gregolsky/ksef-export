import { createPublicKey, publicEncrypt, constants } from 'node:crypto'

/**
 * Encrypts "token|timestampMs" with RSA-OAEP-SHA256 using the KSeF public key.
 * The key is a DER certificate (base64-encoded) returned by the API.
 */
export function encryptKsefToken(token: string, timestampMs: number, certBase64: string): string {
  const derBuffer = Buffer.from(certBase64, 'base64')

  const publicKey = createPublicKey({
    key: derBuffer,
    format: 'der',
    type: 'spki',
  })

  const plaintext = Buffer.from(`${token}|${timestampMs}`, 'utf8')

  const encrypted = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    plaintext,
  )

  return encrypted.toString('base64')
}
