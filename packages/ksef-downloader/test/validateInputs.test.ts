import { describe, it, expect } from 'vitest'
import { validateNip, validateSinkUrls } from '../src/validateInputs.js'

describe('validateNip', () => {
  it('accepts a valid 10-digit NIP', () => {
    expect(() => validateNip('1234567890')).not.toThrow()
  })

  it('rejects a NIP shorter than 10 digits', () => {
    expect(() => validateNip('123456789')).toThrow('10 digits')
  })

  it('rejects a NIP longer than 10 digits', () => {
    expect(() => validateNip('12345678901')).toThrow('10 digits')
  })

  it('rejects a NIP containing letters', () => {
    expect(() => validateNip('123456789a')).toThrow('10 digits')
  })

  it('rejects a NIP with dashes', () => {
    expect(() => validateNip('123-456-78-90')).toThrow('10 digits')
  })

  it('rejects an empty string', () => {
    expect(() => validateNip('')).toThrow('10 digits')
  })
})

describe('validateSinkUrls', () => {
  it('accepts valid http and https URLs', () => {
    expect(() => validateSinkUrls(['http://localhost:3000', 'https://example.com/sink'])).not.toThrow()
  })

  it('accepts an empty array', () => {
    expect(() => validateSinkUrls([])).not.toThrow()
  })

  it('rejects a URL without a scheme', () => {
    expect(() => validateSinkUrls(['//no-scheme.example.com'])).toThrow('Invalid sink URL')
  })

  it('rejects a plain hostname with no scheme', () => {
    expect(() => validateSinkUrls(['not-a-url'])).toThrow('Invalid sink URL')
  })

  it('includes the invalid URL in the error message', () => {
    expect(() => validateSinkUrls(['bad-url'])).toThrow('"bad-url"')
  })

  it('stops at the first invalid URL', () => {
    expect(() => validateSinkUrls(['http://ok.com', 'bad-url', 'also-bad'])).toThrow('"bad-url"')
  })
})
