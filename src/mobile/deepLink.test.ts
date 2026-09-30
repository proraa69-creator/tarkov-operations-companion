import { describe, expect, it } from 'vitest'
import { parseAccountDeepLink } from './deepLink'

const CODE = 'a'.repeat(21) + 'B_-' + '9'.repeat(19)

describe('QR sign-in deep links', () => {
  it('reads the one-time sign-in code and the server', () => {
    expect(parseAccountDeepLink(`tarkovoperator://login?code=${CODE}&server=https%3A%2F%2Ftarkov.example.ru`)).toEqual({ kind: 'login', code: CODE, server: 'https://tarkov.example.ru' })
  })
  it('reads a website approval code', () => {
    expect(parseAccountDeepLink('tarkovoperator://approve?code=k7qx-m2pd&server=https://tarkov.example.ru')).toEqual({ kind: 'approve', code: 'K7QX-M2PD', server: 'https://tarkov.example.ru' })
  })
  it('ignores other schemes, actions and malformed codes', () => {
    expect(parseAccountDeepLink(`https://tarkov.example.ru/app-login?code=${CODE}`)).toBeNull()
    expect(parseAccountDeepLink(`tarkovoperator://logout?code=${CODE}`)).toBeNull()
    expect(parseAccountDeepLink('tarkovoperator://login?code=short')).toBeNull()
    expect(parseAccountDeepLink('tarkovoperator://approve?code=<script>')).toBeNull()
    expect(parseAccountDeepLink('not a url')).toBeNull()
  })
})
