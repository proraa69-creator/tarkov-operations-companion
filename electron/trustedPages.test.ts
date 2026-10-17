// @vitest-environment node
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isAppPageUrl, isEmbeddableWebviewUrl, isExternalAllowed } from './trustedPages'

// A portable exe unpacks to %TEMP%; the user name has a space (and may be Cyrillic).
const WIN_INDEX = 'C:\\Users\\BANGKOK PC\\AppData\\Local\\Temp\\2nX1\\resources\\app.asar\\dist\\index.html'
const WIN_URL = 'file:///C:/Users/BANGKOK%20PC/AppData/Local/Temp/2nX1/resources/app.asar/dist/index.html'
const win = { indexFile: WIN_INDEX, windows: true }

describe('app pages (will-navigate of the main window, IPC senders)', () => {
  it('accepts the renderer file with any route, as Chromium reports it on Windows', () => {
    expect(isAppPageUrl(WIN_URL, win)).toBe(true)
    expect(isAppPageUrl(`${WIN_URL}#/maps/customs`, win)).toBe(true)
    expect(isAppPageUrl(`${WIN_URL}?x=1#/settings`, win)).toBe(true)
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
    expect(isAppPageUrl('file:///opt/Raid%20OS/resources/app.asar/dist/index.html#/maps/customs', posix)).toBe(true)
    expect(isAppPageUrl('file:///opt/raid%20os/resources/app.asar/dist/index.html', posix)).toBe(false)
    expect(isAppPageUrl('file:///opt/Raid%20OS/resources/app.asar/dist/other/index.html', posix)).toBe(false)
  })

  it('trusts exactly the dev server origin, and only when there is one', () => {
    const dev = { ...win, devUrl: 'http://127.0.0.1:5173' }
    expect(isAppPageUrl('http://127.0.0.1:5173/', dev)).toBe(true)
    expect(isAppPageUrl('http://127.0.0.1:5173/#/settings', dev)).toBe(true)
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

describe('the staged build\'s page after a live update (electron/deltaUpdate.ts liveRendererIndex)', () => {
  const LIVE = 'C:\\Users\\BANGKOK PC\\AppData\\Roaming\\Raid OS Updates\\client\\1792000000000\\app.asar\\dist\\index.html'
  const LIVE_URL = 'file:///C:/Users/BANGKOK%20PC/AppData/Roaming/Raid%20OS%20Updates/client/1792000000000/app.asar/dist/index.html'
  const live = { ...win, liveIndexFile: LIVE }

  it('trusts exactly that file with any route, next to the exe\'s own page', () => {
    expect(isAppPageUrl(LIVE_URL, live)).toBe(true)
    expect(isAppPageUrl(`${LIVE_URL}#/maps/customs`, live)).toBe(true)
    expect(isAppPageUrl(LIVE_URL.replace('file:///C:/Users/BANGKOK%20PC', 'file:///c:/users/bangkok%20pc'), live)).toBe(true)
    expect(isAppPageUrl(WIN_URL, live)).toBe(true) // the way back (rollback) stays trusted
    expect(isAppPageUrl(LIVE_URL, win)).toBe(false) // only while it is the live page
    expect(isAppPageUrl(LIVE_URL, { ...win, liveIndexFile: '' })).toBe(false)
  })

  it('nothing else in that build or folder, another build, or a file that is not an archive\'s dist/index.html', () => {
    expect(isAppPageUrl(LIVE_URL.replace('index.html', 'evil.html'), live)).toBe(false)
    expect(isAppPageUrl(LIVE_URL.replace('1792000000000', '1793000000000'), live)).toBe(false)
    expect(isAppPageUrl(LIVE_URL.replace('/app.asar/', '/app.asar.unpacked/'), live)).toBe(false)
    expect(isAppPageUrl('file:///C:/Users/BANGKOK%20PC/Downloads/index.html', live)).toBe(false)
    // A live path that is not app.asar/dist/index.html, relative, with «..», or on a network share is never trusted.
    const refused = [
      'C:\\Users\\x\\Downloads\\index.html',
      'C:\\Users\\x\\Downloads\\dist\\index.html',
      'Raid OS Updates\\client\\1\\app.asar\\dist\\index.html',
      'C:\\Users\\x\\..\\app.asar\\dist\\index.html',
      '\\\\attacker\\share\\app.asar\\dist\\index.html',
    ]
    for (const liveIndexFile of refused) expect(isAppPageUrl(pathToFileURL(liveIndexFile, { windows: true }).href, { ...win, liveIndexFile })).toBe(false)
    expect(isAppPageUrl('file://attacker/share/app.asar/dist/index.html', { ...win, liveIndexFile: '\\\\attacker\\share\\app.asar\\dist\\index.html' })).toBe(false)
  })

  it('POSIX paths exactly', () => {
    const posix = { indexFile: '/opt/Raid OS/resources/app.asar/dist/index.html', liveIndexFile: '/home/p/.config/Raid OS Updates/client/1792000000000/app.asar/dist/index.html', windows: false }
    expect(isAppPageUrl('file:///home/p/.config/Raid%20OS%20Updates/client/1792000000000/app.asar/dist/index.html#/', posix)).toBe(true)
    expect(isAppPageUrl('file:///home/p/.config/raid%20os%20updates/client/1792000000000/app.asar/dist/index.html', posix)).toBe(false)
    expect(isAppPageUrl('file:///home/p/x/index.html', { ...posix, liveIndexFile: '/home/p/x/index.html' })).toBe(false)
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

describe('<webview> attach (will-attach-webview)', () => {
  it('attaches none: the app embeds no outside pages', () => {
    expect(isEmbeddableWebviewUrl('https://escapefromtarkov.fandom.com/ru/wiki/x')).toBe(false)
    expect(isEmbeddableWebviewUrl('https://tarkov.dev/map/customs')).toBe(false)
    expect(isEmbeddableWebviewUrl('http://escapefromtarkov.fandom.com/ru/wiki/x')).toBe(false)
    expect(isEmbeddableWebviewUrl('https://escapefromtarkov.fandom.com.evil.com/')).toBe(false)
    expect(isEmbeddableWebviewUrl('https://evil.fandom.com/')).toBe(false)
    expect(isEmbeddableWebviewUrl('https://escapefromtarkov.fandom.com:8443/')).toBe(false)
    expect(isEmbeddableWebviewUrl('https://user:pw@escapefromtarkov.fandom.com/')).toBe(false)
    expect(isEmbeddableWebviewUrl('file:///C:/app/dist/index.html')).toBe(false)
    expect(isEmbeddableWebviewUrl('')).toBe(false)
  })
})
