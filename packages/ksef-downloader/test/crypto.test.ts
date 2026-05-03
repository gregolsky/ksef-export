import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { encryptKsefToken } from '../src/ksef/crypto.js'

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const certBase64 = (publicKey as Buffer).toString('base64')
  return { certBase64, privateKeyPem: privateKey as string }
}

describe('encryptKsefToken', () => {
  it('roundtrips: encrypt then decrypt equals original plaintext', () => {
    const { certBase64, privateKeyPem } = makeKeypair()
    const token = 'my-secret-token'
    const ts = 1700000000000

    const cipherB64 = encryptKsefToken(token, ts, certBase64)
    const cipherBuf = Buffer.from(cipherB64, 'base64')

    const decrypted = privateDecrypt(
      { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      cipherBuf,
    )

    expect(decrypted.toString('utf8')).toBe(`${token}|${ts}`)
  })

  it('returns valid base64', () => {
    const { certBase64 } = makeKeypair()
    const result = encryptKsefToken('tok', 12345, certBase64)
    expect(() => Buffer.from(result, 'base64')).not.toThrow()
    expect(result.length).toBeGreaterThan(0)
  })

  it('produces different ciphertext on each call (RSA-OAEP randomization)', () => {
    const { certBase64 } = makeKeypair()
    const a = encryptKsefToken('tok', 12345, certBase64)
    const b = encryptKsefToken('tok', 12345, certBase64)
    expect(a).not.toBe(b)
  })
})
