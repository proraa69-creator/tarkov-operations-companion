// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownerChangePrompt } from './ownerConfirm'

describe('owner confirmation dialog (M2)', () => {
  it('lists the changed fields but never shows a secret', () => {
    const prompt = ownerChangePrompt('payments', { shopId: '123456', monthPrice: 299, secretKey: 'live_SECRET_VALUE', apiKey: 'K', clearKey: true })
    expect(prompt.message).toBe('Изменить настройки оплаты?')
    expect(prompt.detail).toContain('shopId: 123456')
    expect(prompt.detail).toContain('monthPrice: 299')
    expect(prompt.detail).toContain('secretKey: будет заменён')
    expect(prompt.detail).toContain('clearKey: будет удалён')
    expect(prompt.detail).not.toContain('live_SECRET_VALUE')
  })

  it('tunnel: the address is shown, the token is not', () => {
    const prompt = ownerChangePrompt('tunnel', { hostname: 'tarkov.example.com', token: 'eyJsecret' })
    expect(prompt.detail).toContain('tarkov.example.com')
    expect(prompt.detail).not.toContain('eyJsecret')
  })

  it('server update and error reports hide the GitHub token', () => {
    for (const change of ['server-update', 'error-reports'] as const) {
      const prompt = ownerChangePrompt(change, { repo: 'someone/else', token: 'ghp_secret', enabled: true })
      expect(prompt.detail).toContain('repo: someone/else')
      expect(prompt.detail).not.toContain('ghp_secret')
    }
  })

  it('every owner setter in main.ts asks before applying; the main window is sandboxed', () => {
    const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')
    for (const [channel, change] of [
      ['owner:set-payments', 'payments'], ['owner:set-sms', 'sms'], ['owner:set-email', 'email'], ['tunnel:set-named', 'tunnel'],
      ['owner:set-emails', 'owner-emails'], ['owner:set-error-reports', 'error-reports'], ['owner:set-server-update', 'server-update'],
    ]) {
      const start = main.indexOf(`ipcMain.handle('${channel}'`)
      expect(start, channel).toBeGreaterThan(-1)
      expect(main.slice(start, start + 260), channel).toContain(`await confirmOwnerChange(event, '${change}'`)
    }
    expect(main).toMatch(/preload: join\(appDir, '\.\.\/\.\.\/electron\/preload\.cjs'\),\s*contextIsolation: true,\s*nodeIntegration: false,[^]*?sandbox: true,/)
    // The players' app cannot change its server (M1).
    expect(main.slice(main.indexOf('const OWNER_CHANNELS'), main.indexOf('function registerIpc'))).toContain("'account:set-server-url'")
  })

  it('the sandboxed preload requires nothing but electron', () => {
    const preload = readFileSync(join(__dirname, 'preload.cjs'), 'utf8')
    expect(preload.match(/require\(([^)]*)\)/g)).toEqual(["require('electron')"])
  })
})
