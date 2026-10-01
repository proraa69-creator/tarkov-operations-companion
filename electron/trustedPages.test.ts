// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isAppPageUrl, isExternalAllowed } from './trustedPages'

// A portable exe unpacks to %TEMP%; the user name has a space (and may be Cyrillic).
const WIN_INDEX = 'C:\\Users\\BANGKOK PC\\AppData\\Local\\Temp\\2nX1\\resources\\app.asar\\dist\\index.html'
const WIN_URL = 'file:///C:/Users/BANGKOK%20PC/AppData/Local/Temp/2nX1/resources/app.asar/dist/index.html'
const win = { indexFile: WIN_INDEX, windows: true }

describe('app pages (will-navigate of the main window, IPC senders)', () => {
  it('accepts the renderer file with any route, as Chromium reports it on Windows', () => {
    expect(isAppPageUrl(WIN_URL, win)).toBe(true)
    expect(isAppPageUrl(`${WIN_URL}#/overlay/item`, win)).toBe(true)
    expect(isAppPageUrl(`${WIN_URL}?x=1#/overlay/minimap`, win)).toBe(true)
    expect(isAppPageUrl(WIN_URL.replace('file:///C:/Users/BANGKOK%20PC', 'file:///c:/users/bangkok%20pc'), win)).toBe(true)
    const cyrillic = 'C:\\Users\\Игрок\\AppData\\Local\\Temp\\x\\resources\\app.asar\\dist\\index.html'
    expect(isAppPageUrl(`file:///C:/Users/${encodeURIComponent('Игрок')}/AppData/Local/Temp/x/resources/app.asar/dist/index.html#/`, { indexFile: cyrillic, windows: true })).toBe(true)
  })

  it('refuses other files and web pages', () => {
    expect(isAppPageUrl(WIN_URL.replace('index.html', 'evil.html'), win)).toBe(false)
    expect(isAppPageUrl('file:///C:/Users/BANGKOK%20PC/Downloads/index.html', win)).toBe(false)
    expect(isAppPageUrl('file://attacker/share/resources/app.asar/dist/index.html', win)).toBe(false)
    expect(isAppPageUrl('https://escapefromtarkov.fandom.com/ru/wiki/x', win)).toBe(false)
    expect(isAppPageUrl('about:blank', win)).toBe(false)
    expect(isAppPageUrl('not a url', win)).toBe(false)
  })

  it('compares POSIX paths exactly', () => {
    const posix = { indexFile: '/opt/Raid OS/resources/app.asar/dist/index.html', windows: false }
    expect(isAppPageUrl('file:///opt/Raid%20OS/resources/app.asar/dist/index.html#/overlay/item', posix)).toBe(true)
    expect(isAppPageUrl('file:///opt/raid%20os/resources/app.asar/dist/index.html', posix)).toBe(false)
    expect(isAppPageUrl('file:///opt/Raid%20OS/resources/app.asar/dist/other/index.html', posix)).toBe(false)
  })

  it('trusts exactly the dev server origin, and only when there is one', () => {
    const dev = { ...win, devUrl: 'http://127.0.0.1:5173' }
    expect(isAppPageUrl('http://127.0.0.1:5173/', dev)).toBe(true)
    expect(isAppPageUrl('http://127.0.0.1:5173/#/overlay/minimap', dev)).toBe(true)
    expect(isAppPageUrl('http://127.0.0.1.evil.com/', dev)).toBe(false)
    expect(isAppPageUrl('http://127.0.0.1.evil.com:5173/', dev)).toBe(false)
    expect(isAppPageUrl('http://127.0.0.1:5174/', dev)).toBe(false)
    expect(isAppPageUrl('https://127.0.0.1:5173/', dev)).toBe(false)
    expect(isAppPageUrl('http://localhost:5173/', dev)).toBe(false)
    expect(isAppPageUrl('http://127.0.0.1:5173@evil.com/', dev)).toBe(false)
    expect(isAppPageUrl('http://127.0.0.1:5173/', win)).toBe(false) // no dev server: only the file
    expect(isAppPageUrl('file:///C:/other.html', { ...win, devUrl: 'file:///C:/other.html' })).toBe(false) // no opaque «origin»
  })
})

describe('links opened in the system browser (setWindowOpenHandler)', () => {
  it('opens HTTPS pages and this computer\'s site only by exact host', () => {
    expect(isExternalAllowed('https://raidos.app/cabinet')).toBe(true)
    expect(isExternalAllowed('http://localhost:5202/')).toBe(true)
    expect(isExternalAllowed('http://127.0.0.1:8787/health')).toBe(true)
    expect(isExternalAllowed('http://127.0.0.1.evil.com/')).toBe(false)
    expect(isExternalAllowed('http://evil.example/')).toBe(false)
    expect(isExternalAllowed('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isExternalAllowed('javascript:alert(1)')).toBe(false)
    expect(isExternalAllowed('ms-settings:privacy')).toBe(false)
  })
})
