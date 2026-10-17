/**
 * In-app updates of the Android build (owner, 13.10.2026: «добавь туда автообновление внутри приложения … пока мы можем
 * не добавлять приложение в play market оно будет у нас на сайте»). At start, and back from the background after half a
 * day, the app reads https://raidos.app/download/android/version.json. A newer build downloads by itself on Wi-Fi (on
 * mobile data after «Скачать») and is checked by the native side: size, SHA-256, package, version and signing key
 * (android/app/src/main/java/com/tarkovoperator/app/ApkUpdaterPlugin.java). «Установить» then opens Android's
 * installer: nothing is installed without the player's tap, so an update never closes the app in a raid.
 *
 * Nothing is published on the site yet: the description answers 404 and the app says «Обновлений на сайте пока нет».
 * The description and the APK go to /download/android/ (docs/mobile.md «Обновление Android-версии»).
 */
import { App } from '@capacitor/app'
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { useSyncExternalStore } from 'react'
import { isAndroidApp } from '../platform'

export const ANDROID_RELEASE_URL = 'https://raidos.app/download/android/version.json'
const RELEASE_HOST = 'raidos.app'
const RELEASE_PATH = '/download/android/'
const MAX_APK_BYTES = 300 * 1024 * 1024
const AUTO_DOWNLOAD_KEY = 'raidos-android-auto-download-v1'
/** A phone keeps the app open for days: back from the background after this long counts as a new start. */
export const RECHECK_AFTER_MS = 12 * 60 * 60 * 1000

/** /download/android/version.json: the newest Android build on the site. */
export interface AndroidRelease { versionCode: number; versionName: string; url: string; sha256: string; size: number }

export interface ApkUpdaterPlugin {
  info(): Promise<{ versionCode: number; versionName: string; canInstall: boolean; metered: boolean }>
  fetchManifest(options: { url: string }): Promise<{ status: number; body?: string }>
  download(options: { url: string; sha256: string; size: number; versionCode: number }): Promise<{ ready: boolean }>
  install(options: { versionCode: number }): Promise<{ started: boolean; needsPermission?: boolean }>
  openInstallSettings(): Promise<void>
  cleanup(options: { keepVersionCode?: number }): Promise<void>
  addListener(eventName: 'downloadProgress', listener: (progress: { received: number; total: number }) => void): Promise<PluginListenerHandle>
}

/**
 * off: not the Android app · checking · latest: this is the newest build · none: nothing published yet · available: a
 * newer build waits for «Скачать» · downloading · ready: downloaded and checked · installing: Android's installer is
 * open · permission: Android asks to allow installs from Raid OS · error.
 */
export type AndroidUpdatePhase = 'off' | 'idle' | 'checking' | 'latest' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'permission' | 'error'

export interface AndroidUpdateState {
  phase: AndroidUpdatePhase
  current?: { versionCode: number; versionName: string }
  release?: AndroidRelease
  /** 0–100 while downloading. */
  progress?: number
  /** A code of ApkUpdaterPlugin ('network', 'checksum', 'signature', 'http-503', …): androidUpdateErrorText. */
  error?: string
  /** What failed: the banner shows only what the player started (a failed check at start stays in Settings). */
  failed?: 'check' | 'download' | 'install'
  checkedAt?: number
  metered?: boolean
  autoDownload: boolean
  /** «Позже» on the banner for this build: hidden until a newer one or the next start. */
  dismissed?: number
}

const ERROR_TEXT: Record<string, string> = {
  network: 'Нет связи с сайтом обновлений',
  'bad-url': 'Неверный адрес обновления',
  'bad-release': 'Описание обновления на сайте повреждено',
  'too-large': 'Описание обновления на сайте повреждено',
  size: 'Размер файла обновления не совпал',
  incomplete: 'Обновление скачалось не полностью, попробуйте ещё раз',
  checksum: 'Файл обновления повреждён: контрольная сумма не совпала',
  storage: 'Не удалось сохранить обновление: проверьте свободное место',
  package: 'Скачанный файл — не приложение Raid OS',
  version: 'Скачанный файл — не та версия',
  signature: 'Обновление подписано другим ключом: удалите приложение и установите его заново с сайта',
  busy: 'Обновление уже загружается',
  missing: 'Файл обновления не найден, скачайте его ещё раз',
  installer: 'На телефоне не открылась установка приложений',
  info: 'Не удалось узнать версию приложения',
}

/** The player's message for a code of ApkUpdaterPlugin (Russian; uiText gives the English one). */
export function androidUpdateErrorText(code: string | undefined) {
  if (!code) return ''
  if (/^http-\d+$/.test(code)) return 'Сайт обновлений ответил ошибкой'
  return ERROR_TEXT[code] ?? ERROR_TEXT.network
}

/** Only an HTTPS file under raidos.app/download/android/ is accepted (the native side checks the same). */
export function isAndroidReleaseUrl(raw: string) {
  if (/\.\.|%|\\|\/\//.test(raw.replace(/^https:\/\//, ''))) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === RELEASE_HOST && (url.port === '' || url.port === '443') && !url.username && !url.password
      && !url.search && !url.hash && url.pathname.startsWith(RELEASE_PATH) && url.pathname.length > RELEASE_PATH.length
  } catch {
    return false
  }
}

/** version.json → the release, or null when anything in it is missing or wrong. */
export function parseAndroidRelease(text: string): AndroidRelease | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const { versionCode, versionName, url, sha256, size } = value as Record<string, unknown>
  if (typeof versionCode !== 'number' || !Number.isSafeInteger(versionCode) || versionCode <= 0) return null
  if (typeof versionName !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}(\.\d{1,4})?$/.test(versionName)) return null
  if (typeof url !== 'string' || !isAndroidReleaseUrl(url)) return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_APK_BYTES) return null
  return { versionCode, versionName, url, sha256, size }
}

class UpdateFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const codeOf = (reason: unknown) => {
  const code = (reason as { code?: unknown } | null)?.code
  return typeof code === 'string' && code ? code : 'network'
}

interface Dependencies {
  plugin: ApkUpdaterPlugin
  /** Called with a handler for «the app is back in the foreground». */
  onResume: (handler: () => void) => void
  enabled: boolean
  now?: () => number
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

export type AndroidUpdater = ReturnType<typeof createAndroidUpdater>

export function createAndroidUpdater({ plugin, onResume, enabled, now = Date.now, storage }: Dependencies) {
  const readAuto = () => {
    try { return storage?.getItem(AUTO_DOWNLOAD_KEY) !== '0' } catch { return true }
  }
  let state: AndroidUpdateState = { phase: enabled ? 'idle' : 'off', autoDownload: readAuto() }
  const listeners = new Set<() => void>()
  let started = false
  let checking = false
  let downloading = false

  const set = (patch: Partial<AndroidUpdateState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  async function check() {
    if (!enabled || checking || downloading || state.phase === 'installing') return
    checking = true
    set({ phase: 'checking', error: undefined, failed: undefined })
    try {
      const info = await plugin.info()
      const current = { versionCode: info.versionCode, versionName: info.versionName }
      const answer = await plugin.fetchManifest({ url: ANDROID_RELEASE_URL })
      const checkedAt = now()
      if (answer.status === 404) {
        set({ phase: 'none', current, checkedAt, release: undefined })
        void plugin.cleanup({}).catch(() => {})
        return
      }
      if (answer.status !== 200) throw new UpdateFailure(`http-${answer.status}`)
      const release = answer.body ? parseAndroidRelease(answer.body) : null
      if (!release) throw new UpdateFailure('bad-release')
      if (release.versionCode <= info.versionCode) {
        set({ phase: 'latest', current, checkedAt, release })
        void plugin.cleanup({}).catch(() => {})
        return
      }
      void plugin.cleanup({ keepVersionCode: release.versionCode }).catch(() => {})
      set({ phase: 'available', current, checkedAt, release, metered: info.metered })
      // On Wi-Fi the update comes by itself; on mobile data it waits for «Скачать».
      if (state.autoDownload && !info.metered) {
        checking = false
        await download()
      }
    } catch (reason) {
      // checkedAt stays: the next return to the app tries again.
      set({ phase: 'error', error: codeOf(reason), failed: 'check' })
    } finally {
      checking = false
    }
  }

  async function download() {
    const release = state.release
    if (!enabled || !release || downloading) return
    downloading = true
    set({ phase: 'downloading', progress: 0, error: undefined, failed: undefined })
    let handle: PluginListenerHandle | undefined
    try {
      handle = await plugin.addListener('downloadProgress', ({ received, total }) => {
        if (state.phase === 'downloading' && total > 0) set({ progress: Math.min(100, Math.floor((received * 100) / total)) })
      })
      await plugin.download({ url: release.url, sha256: release.sha256, size: release.size, versionCode: release.versionCode })
      set({ phase: 'ready', progress: 100 })
    } catch (reason) {
      set({ phase: 'error', error: codeOf(reason), failed: 'download' })
    } finally {
      downloading = false
      void handle?.remove()
    }
  }

  async function install() {
    const release = state.release
    if (!enabled || !release || downloading) return
    try {
      const result = await plugin.install({ versionCode: release.versionCode })
      if (result.needsPermission) set({ phase: 'permission', error: undefined, failed: undefined })
      else if (result.started) set({ phase: 'installing', error: undefined, failed: undefined })
    } catch (reason) {
      const code = codeOf(reason)
      // The file went away (the phone cleared the cache): download it again.
      if (code === 'missing') {
        set({ phase: 'available' })
        await download()
        return
      }
      set({ phase: 'error', error: code, failed: 'install' })
    }
  }

  async function resumed() {
    if (!enabled) return
    // Back from Android's installer without installing (an installed update restarts the app).
    if (state.phase === 'installing') {
      set({ phase: 'ready' })
      return
    }
    // Back from «Install unknown apps»: continue the installation once it is allowed.
    if (state.phase === 'permission') {
      const info = await plugin.info().catch(() => null)
      if (info?.canInstall) await install()
      return
    }
    if (now() - (state.checkedAt ?? 0) >= RECHECK_AFTER_MS) await check()
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Once per app start: the first check and the «back from the background» handler. */
    start() {
      if (!enabled || started) return
      started = true
      onResume(() => { void resumed() })
      void check()
    },
    check,
    download,
    install,
    openSettings: () => plugin.openInstallSettings().catch(() => {}),
    dismiss() {
      if (state.release) set({ dismissed: state.release.versionCode })
    },
    setAutoDownload(on: boolean) {
      try { storage?.setItem(AUTO_DOWNLOAD_KEY, on ? '1' : '0') } catch { /* the choice lasts for this start */ }
      set({ autoDownload: on })
      if (on && state.phase === 'available' && !state.metered) void download()
    },
  }
}

let shared: AndroidUpdater | undefined

/** The app's updater (inactive outside the Android app). */
export function androidUpdater() {
  if (!shared) {
    const enabled = isAndroidApp()
    shared = createAndroidUpdater({
      plugin: registerPlugin<ApkUpdaterPlugin>('ApkUpdater'),
      onResume: (handler) => { void App.addListener('resume', handler).catch(() => {}) },
      enabled,
      storage: typeof localStorage === 'undefined' ? undefined : localStorage,
    })
  }
  return shared
}

export function useAndroidUpdate() {
  const updater = androidUpdater()
  return useSyncExternalStore(updater.subscribe, updater.getState, updater.getState)
}
