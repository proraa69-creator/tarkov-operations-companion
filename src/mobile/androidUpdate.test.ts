import { describe, expect, it, vi } from 'vitest'
import { ANDROID_RELEASE_URL, androidUpdateErrorText, createAndroidUpdater, isAndroidReleaseUrl, parseAndroidRelease, RECHECK_AFTER_MS, type ApkUpdaterPlugin } from './androidUpdater'

/** In-app updates of the Android app (owner, 13.10.2026): the site's version.json, Wi-Fi download, «Установить». */
const SHA = 'a'.repeat(64)
const release = { versionCode: 600030, versionName: '0.6.0.30', url: 'https://raidos.app/download/android/raid-os-0.6.0.30.apk', sha256: SHA, size: 31_457_280 }

function fakePlugin(options: { manifest?: { status: number; body?: string }; metered?: boolean; canInstall?: boolean[]; download?: () => Promise<{ ready: boolean }>; install?: () => Promise<{ started: boolean; needsPermission?: boolean }> } = {}) {
  const canInstall = [...(options.canInstall ?? [true])]
  let progress: ((value: { received: number; total: number }) => void) | undefined
  const plugin = {
    info: vi.fn(async () => ({ versionCode: 600029, versionName: '0.6.0.29', canInstall: canInstall.length > 1 ? canInstall.shift()! : canInstall[0], metered: options.metered ?? false })),
    fetchManifest: vi.fn(async () => options.manifest ?? { status: 200, body: JSON.stringify(release) }),
    download: vi.fn(options.download ?? (async () => {
      progress?.({ received: release.size / 2, total: release.size })
      return { ready: true }
    })),
    install: vi.fn(options.install ?? (async () => ({ started: true }))),
    openInstallSettings: vi.fn(async () => {}),
    cleanup: vi.fn(async () => {}),
    addListener: vi.fn(async (_event: 'downloadProgress', listener: (value: { received: number; total: number }) => void) => {
      progress = listener
      return { remove: async () => { progress = undefined } }
    }),
  } satisfies ApkUpdaterPlugin
  return plugin
}

function setup(plugin: ApkUpdaterPlugin, enabled = true) {
  let resume: (() => void) | undefined
  let time = Date.parse('2026-10-13T12:00:00Z')
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  const updater = createAndroidUpdater({ plugin, enabled, onResume: (handler) => { resume = handler }, now: () => time, storage })
  return {
    updater,
    store,
    resume: async () => { resume?.(); await vi.waitFor(() => {}) },
    advance: (ms: number) => { time += ms },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('version.json', () => {
  it('takes only a complete release from the site download folder', () => {
    expect(parseAndroidRelease(JSON.stringify(release))).toEqual(release)
    expect(parseAndroidRelease(JSON.stringify({ ...release, notes: 'лишнее поле не мешает' }))).toEqual(release)
    for (const broken of [
      'not json', 'null', '[]',
      JSON.stringify({ ...release, versionCode: 0 }),
      JSON.stringify({ ...release, versionCode: 1.5 }),
      JSON.stringify({ ...release, versionName: '0.6.0.30-beta' }),
      JSON.stringify({ ...release, sha256: SHA.toUpperCase() }),
      JSON.stringify({ ...release, size: 0 }),
      JSON.stringify({ ...release, size: 400 * 1024 * 1024 }),
      JSON.stringify({ ...release, url: 'http://raidos.app/download/android/a.apk' }),
    ]) expect(parseAndroidRelease(broken)).toBeNull()
  })

  it('accepts HTTPS files under raidos.app/download/android/ only', () => {
    expect(isAndroidReleaseUrl('https://raidos.app/download/android/raid-os.apk')).toBe(true)
    for (const bad of [
      'https://raidos.app.evil.example/download/android/a.apk', 'https://evil.example/download/android/a.apk', 'https://raidos.app/download/windows',
      'https://raidos.app/download/android/', 'https://raidos.app/download/android/../windows', 'https://raidos.app/download/android/%2e%2e/x',
      'https://raidos.app/download/android//a.apk', 'https://raidos.app/download/android/a.apk?x=1', 'https://user@raidos.app/download/android/a.apk',
      'https://raidos.app:8443/download/android/a.apk',
    ]) expect(isAndroidReleaseUrl(bad)).toBe(false)
  })

  it('names every failure for the player', () => {
    expect(androidUpdateErrorText('signature')).toMatch(/другим ключом/)
    expect(androidUpdateErrorText('http-503')).toBe('Сайт обновлений ответил ошибкой')
    expect(androidUpdateErrorText('something-new')).toBe('Нет связи с сайтом обновлений')
  })
})

describe('the Android updater', () => {
  it('on Wi-Fi downloads a newer build by itself, then «Установить» opens the installer', async () => {
    const plugin = fakePlugin()
    const { updater } = setup(plugin)
    const seen: number[] = []
    updater.subscribe(() => { const { progress } = updater.getState(); if (progress !== undefined) seen.push(progress) })
    updater.start()
    await vi.waitFor(() => expect(updater.getState().phase).toBe('ready'))
    expect(plugin.fetchManifest).toHaveBeenCalledWith({ url: ANDROID_RELEASE_URL })
    expect(plugin.cleanup).toHaveBeenCalledWith({ keepVersionCode: 600030 })
    expect(plugin.download).toHaveBeenCalledWith({ url: release.url, sha256: SHA, size: release.size, versionCode: 600030 })
    expect(seen).toContain(50)
    expect(updater.getState()).toMatchObject({ current: { versionCode: 600029 }, release, progress: 100 })

    await updater.install()
    expect(plugin.install).toHaveBeenCalledWith({ versionCode: 600030 })
    expect(updater.getState().phase).toBe('installing')
  })

  it('on mobile data waits for «Скачать»', async () => {
    const plugin = fakePlugin({ metered: true })
    const { updater } = setup(plugin)
    updater.start()
    await vi.waitFor(() => expect(updater.getState().phase).toBe('available'))
    expect(plugin.download).not.toHaveBeenCalled()
    await updater.download()
    expect(updater.getState().phase).toBe('ready')
  })

  it('with automatic download off it only says a version is there', async () => {
    const plugin = fakePlugin()
    const { updater, store } = setup(plugin)
    updater.setAutoDownload(false)
    expect(store.get('raidos-android-auto-download-v1')).toBe('0')
    updater.start()
    await vi.waitFor(() => expect(updater.getState().phase).toBe('available'))
    expect(plugin.download).not.toHaveBeenCalled()
    updater.setAutoDownload(true)
    await vi.waitFor(() => expect(updater.getState().phase).toBe('ready'))
  })

  it('nothing published (404) and the same build are quiet, and old downloads are removed', async () => {
    const none = fakePlugin({ manifest: { status: 404 } })
    const first = setup(none)
    await first.updater.check()
    expect(first.updater.getState().phase).toBe('none')
    expect(none.cleanup).toHaveBeenCalledWith({})

    const same = fakePlugin({ manifest: { status: 200, body: JSON.stringify({ ...release, versionCode: 600029, versionName: '0.6.0.29' }) } })
    const second = setup(same)
    await second.updater.check()
    expect(second.updater.getState().phase).toBe('latest')
    expect(same.download).not.toHaveBeenCalled()
  })

  it('a failed download is kept for «Повторить»; a failed check at start stays out of the banner', async () => {
    const plugin = fakePlugin({ download: async () => { throw Object.assign(new Error('checksum'), { code: 'checksum' }) } })
    const { updater } = setup(plugin)
    await updater.check()
    expect(updater.getState()).toMatchObject({ phase: 'error', error: 'checksum', failed: 'download', release })

    const offline = fakePlugin({ manifest: { status: 503 } })
    const other = setup(offline)
    await other.updater.check()
    expect(other.updater.getState()).toMatchObject({ phase: 'error', error: 'http-503', failed: 'check' })
  })

  it('asks for the install permission and continues once the player comes back with it', async () => {
    const plugin = fakePlugin({ canInstall: [true, false, true], install: vi.fn().mockResolvedValueOnce({ started: false, needsPermission: true }).mockResolvedValue({ started: true }) })
    const { updater, resume } = setup(plugin)
    updater.start()
    await vi.waitFor(() => expect(updater.getState().phase).toBe('ready'))
    await updater.install()
    expect(updater.getState().phase).toBe('permission')
    // Still not allowed: nothing happens.
    await resume()
    await settle()
    expect(plugin.install).toHaveBeenCalledTimes(1)
    // Allowed: the installer opens without another tap.
    await resume()
    await vi.waitFor(() => expect(updater.getState().phase).toBe('installing'))
    expect(plugin.install).toHaveBeenCalledTimes(2)
  })

  it('back from the installer without installing offers «Установить» again; half a day later it checks again', async () => {
    const plugin = fakePlugin()
    const { updater, resume, advance } = setup(plugin)
    updater.start()
    await vi.waitFor(() => expect(updater.getState().phase).toBe('ready'))
    await updater.install()
    await resume()
    expect(updater.getState().phase).toBe('ready')
    expect(plugin.fetchManifest).toHaveBeenCalledTimes(1)

    await resume()
    await settle()
    expect(plugin.fetchManifest).toHaveBeenCalledTimes(1)
    advance(RECHECK_AFTER_MS)
    await resume()
    await vi.waitFor(() => expect(plugin.fetchManifest).toHaveBeenCalledTimes(2))
  })

  it('a missing file is downloaded again on «Установить»', async () => {
    const plugin = fakePlugin({ install: vi.fn().mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'missing' })).mockResolvedValue({ started: true }) })
    const { updater } = setup(plugin)
    await updater.check()
    expect(updater.getState().phase).toBe('ready')
    await updater.install()
    expect(plugin.download).toHaveBeenCalledTimes(2)
    expect(updater.getState().phase).toBe('ready')
  })

  it('does nothing outside the Android app', async () => {
    const plugin = fakePlugin()
    const { updater } = setup(plugin, false)
    updater.start()
    await updater.check()
    expect(updater.getState().phase).toBe('off')
    expect(plugin.info).not.toHaveBeenCalled()
  })
})
