// @vitest-environment node
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A stand-in for Electron's ipcMain: handle() keeps one handler per channel (invoke), on()/emit() is an EventEmitter.
const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  class FakeIpcMain extends EventEmitter {
    handlers = new Map<string, Handler>()
    handle = (channel: string, handler: Handler) => {
      if (this.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
      this.handlers.set(channel, handler)
    }
    handleOnce = (channel: string, handler: Handler) => this.handle(channel, (event, ...args) => { this.removeHandler(channel); return handler(event, ...args) })
    removeHandler(channel: string) { this.handlers.delete(channel) }
    async invoke(channel: string, event: unknown, ...args: unknown[]) {
      const handler = this.handlers.get(channel)
      if (!handler) throw new Error(`No handler registered for '${channel}'`)
      return handler(event, ...args)
    }
  }
  return { ipcMain: new FakeIpcMain(), app: { isPackaged: true } }
})
vi.mock('electron', () => ({ ipcMain: electron.ipcMain, app: electron.app }))

const { APP_INDEX_FILE, isTrustedAppPage, trustLiveRenderer } = await import('./ipcGuard')
const { ipcMain } = electron

const APP_PAGE = pathToFileURL(APP_INDEX_FILE).href
const from = (url: string | null) => ({ senderFrame: url === null ? null : { url }, returnValue: undefined as unknown })

describe('IPC only from the app\'s own pages (electron/ipcGuard.ts)', () => {
  afterEach(() => { ipcMain.removeAllListeners(); ipcMain.handlers.clear(); electron.app.isPackaged = true; delete process.env.ELECTRON_RENDERER_URL; trustLiveRenderer('') })

  it('trusts the renderer file with any route of the main window', () => {
    expect(APP_INDEX_FILE.replace(/\\/g, '/')).toMatch(/\/dist\/index\.html$/)
    for (const route of ['', '#/', '#/maps/customs', '#/settings']) expect(isTrustedAppPage(`${APP_PAGE}${route}`)).toBe(true)
    expect(isTrustedAppPage('https://escapefromtarkov.fandom.com/ru/wiki/x')).toBe(false)
  })

  it('invoke: answers app pages, rejects anything else', async () => {
    ipcMain.handle('account:status', (_event: unknown, value: unknown) => ({ ok: true, value }))
    await expect(ipcMain.invoke('account:status', from(`${APP_PAGE}#/profile`), 7)).resolves.toEqual({ ok: true, value: 7 })
    await expect(ipcMain.invoke('account:status', from('https://evil.example/'))).rejects.toThrow(/refused/)
    await expect(ipcMain.invoke('account:status', from('http://127.0.0.1.evil.com/'))).rejects.toThrow(/refused/)
    await expect(ipcMain.invoke('account:status', from(null))).rejects.toThrow(/refused/) // the frame navigated away or is gone
    ipcMain.removeHandler('account:status')
    expect(ipcMain.handlers.has('account:status')).toBe(false)
  })

  it('send / sendSync: delivered from app pages, ignored otherwise (a refused sendSync gets null, never hangs)', () => {
    const listener = vi.fn((event: { returnValue: unknown }) => { event.returnValue = 'client' })
    ipcMain.on('app:edition', listener)
    const trusted = from(`${APP_PAGE}#/maps/customs`)
    ipcMain.emit('app:edition', trusted)
    expect(trusted.returnValue).toBe('client')
    const stranger = from('https://evil.example/')
    ipcMain.emit('app:edition', stranger)
    expect(stranger.returnValue).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
    // Removing the original listener still works.
    ipcMain.removeListener('app:edition', listener)
    expect(ipcMain.listenerCount('app:edition')).toBe(0)
  })

  it('once / handleOnce cannot be used up by a stranger', async () => {
    const listener = vi.fn()
    ipcMain.once('app:test-once', listener)
    ipcMain.emit('app:test-once', from('https://evil.example/'), true)
    expect(listener).not.toHaveBeenCalled()
    ipcMain.emit('app:test-once', from(APP_PAGE), true)
    ipcMain.emit('app:test-once', from(APP_PAGE), false)
    expect(listener).toHaveBeenCalledTimes(1)

    ipcMain.handleOnce('update:check', () => 'checked')
    await expect(ipcMain.invoke('update:check', from('https://evil.example/'))).rejects.toThrow(/refused/)
    await expect(ipcMain.invoke('update:check', from(APP_PAGE))).resolves.toBe('checked')
    await expect(ipcMain.invoke('update:check', from(APP_PAGE))).rejects.toThrow(/No handler/)
  })

  it('after a live update: exactly the staged build\'s page main.ts loaded, until the window goes back', async () => {
    const live = join(tmpdir(), 'Raid OS Updates', 'client', '1792000000000', 'app.asar', 'dist', 'index.html')
    const LIVE_PAGE = pathToFileURL(live).href
    ipcMain.handle('account:status', () => 'ok')
    await expect(ipcMain.invoke('account:status', from(LIVE_PAGE))).rejects.toThrow(/refused/)
    expect(trustLiveRenderer(live)).toBe(true)
    await expect(ipcMain.invoke('account:status', from(`${LIVE_PAGE}#/maps/customs`))).resolves.toBe('ok')
    await expect(ipcMain.invoke('account:status', from(APP_PAGE))).resolves.toBe('ok')
    await expect(ipcMain.invoke('account:status', from(LIVE_PAGE.replace('index.html', 'evil.html')))).rejects.toThrow(/refused/)
    await expect(ipcMain.invoke('account:status', from(LIVE_PAGE.replace('1792000000000', '1793000000000')))).rejects.toThrow(/refused/)
    // Back to the exe's page (a failed live load): the staged page is a stranger again.
    expect(trustLiveRenderer('')).toBe(false)
    await expect(ipcMain.invoke('account:status', from(LIVE_PAGE))).rejects.toThrow(/refused/)
    // Not an archive's dist/index.html, a relative path, or a development run: refused, and nothing stays trusted.
    for (const file of [join(tmpdir(), 'index.html'), join(tmpdir(), 'dist', 'index.html'), 'app.asar/dist/index.html']) {
      expect(trustLiveRenderer(file)).toBe(false)
      expect(isTrustedAppPage(pathToFileURL(file).href)).toBe(false)
    }
    electron.app.isPackaged = false
    expect(trustLiveRenderer(live)).toBe(false)
    expect(isTrustedAppPage(LIVE_PAGE)).toBe(false)
  })

  it('trusts exactly the dev server only in a development run', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173'
    ipcMain.handle('app:version', () => '0.5.4')
    expect(isTrustedAppPage('http://127.0.0.1:5173/#/settings')).toBe(false) // packaged exe: never
    electron.app.isPackaged = false
    expect(isTrustedAppPage('http://127.0.0.1:5173/#/settings')).toBe(true)
    await expect(ipcMain.invoke('app:version', from('http://127.0.0.1:5173/'))).resolves.toBe('0.5.4')
    await expect(ipcMain.invoke('app:version', from('http://127.0.0.1.evil.com:5173/'))).rejects.toThrow(/refused/)
    await expect(ipcMain.invoke('app:version', from('http://127.0.0.1:5174/'))).rejects.toThrow(/refused/)
  })
})
