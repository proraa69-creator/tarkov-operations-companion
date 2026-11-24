import { describe, expect, it } from 'vitest'
import { parseAccountDeepLink, parseScannedQr } from './deepLink'

const CODE = 'a'.repeat(21) + 'B_-' + '9'.repeat(19)

describe('QR sign-in deep links', () => {
  it('reads the one-time sign-in code and the server', () => {
    expect(parseAccountDeepLink(`tarkovoperator://login?code=${CODE}&server=https%3A%2F%2Ftarkov.example.ru`)).toEqual({ kind: 'login', code: CODE, server: 'https://tarkov.example.ru' })
  })
  it('reads a website approval code', () => {
    expect(parseAccountDeepLink('tarkovoperator://approve?code=k7qx-m2pd&server=https://tarkov.example.ru')).toEqual({ kind: 'approve', code: 'K7QX-M2PD', server: 'https://tarkov.example.ru' })
  })
  it('accepts the raidos:// alias of the renamed app', () => {
    expect(parseAccountDeepLink(`raidos://login?code=${CODE}&server=https://tarkov.example.ru`)).toEqual({ kind: 'login', code: CODE, server: 'https://tarkov.example.ru' })
  })
  it('ignores other schemes, actions and malformed codes', () => {
    expect(parseAccountDeepLink(`https://tarkov.example.ru/app-login?code=${CODE}`)).toBeNull()
    expect(parseAccountDeepLink(`tarkovoperator://logout?code=${CODE}`)).toBeNull()
    expect(parseAccountDeepLink('tarkovoperator://login?code=short')).toBeNull()
    expect(parseAccountDeepLink('tarkovoperator://approve?code=<script>')).toBeNull()
    expect(parseAccountDeepLink('not a url')).toBeNull()
  })
})

describe('a QR code read by the app\'s own camera (owner, 25.11.2026: «вход QR-кодом во все стороны»)', () => {
  const login = 'A'.repeat(43)
  it('takes the website page the PC\'s QR codes lead to, and the app link itself', () => {
    expect(parseScannedQr(`https://raidos.app/app-login#login=${login}`)).toEqual({ kind: 'login', code: login, server: 'https://raidos.app' })
    expect(parseScannedQr('https://raidos.app/app-login#approve=ABCD-EFGH')).toEqual({ kind: 'approve', code: 'ABCD-EFGH', server: 'https://raidos.app' })
    expect(parseScannedQr(`tarkovoperator://login?code=${login}&server=https://raidos.app`)?.kind).toBe('login')
  })
  it('ignores any other QR code', () => {
    expect(parseScannedQr('https://example.com/promo')).toBeNull()
    expect(parseScannedQr('http://raidos.app/app-login#approve=ABCD-EFGH')).toBeNull()
    expect(parseScannedQr('just text')).toBeNull()
  })
})
