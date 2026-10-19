/**
 * «Скачать приложение» for phones (owner, 19.10.2026: «добавь обе версии на сайт… для Android просто файл APK, для
 * iPhone архив»). The builds are made on GitHub (.github/workflows/ios-ipa.yml: the signed APK and the iPhone archive)
 * and published as a GitHub release `mobile-v<version>` of the public repository with a description
 * `mobile-release.json`:
 *   { version, android: { file, size, sha256, versionCode, versionName }, iphone: { file, size, sha256 } }
 * This server keeps a copy of the newest such release and serves it from raidos.app (routes/mobileDownloads.ts), so
 * the Android app updates itself from the site (src/mobile/androidUpdate.ts) and the site's buttons download from it.
 *
 * Every file is checked against the description (size and SHA-256) before it replaces the previous copy; the copy only
 * moves forward. The Android app checks the APK's signature again against its own before Android installs it, so a
 * changed release cannot replace the app with someone else's.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export const MOBILE_REPOSITORY = 'proraa69-creator/tarkov-operations-companion'
export const MOBILE_TAG_PREFIX = 'mobile-v'
export const MOBILE_MANIFEST = 'mobile-release.json'
/** A bigger file is refused before anything is written. */
export const MAX_MOBILE_FILE_BYTES = 400 * 1024 * 1024
const MAX_MANIFEST_BYTES = 16 * 1024
const CURRENT = 'current.json'
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const VERSION = /^[0-9]+(?:[.-][0-9A-Za-z]+){1,4}$/

export interface MobileFile { file: string; size: number; sha256: string }
export interface AndroidFile extends MobileFile { versionCode: number; versionName: string }
export interface MobileRelease { version: string; tag: string; android?: AndroidFile; iphone?: MobileFile }

interface GithubAsset { name?: unknown; browser_download_url?: unknown; size?: unknown }
interface GithubRelease { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown }

function mobileFile(raw: unknown): MobileFile | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.file !== 'string' || !FILE_NAME.test(value.file) || value.file === CURRENT || value.file === MOBILE_MANIFEST) return undefined
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAX_MOBILE_FILE_BYTES) return undefined
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) return undefined
  return { file: value.file, size: value.size, sha256: value.sha256 }
}

/** The release description as published by the workflow; null for anything else. */
export function parseMobileRelease(raw: unknown, tag: string): MobileRelease | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.version !== 'string' || !VERSION.test(value.version) || tag !== `${MOBILE_TAG_PREFIX}${value.version}`) return null
  const release: MobileRelease = { version: value.version, tag }
  if (value.android !== undefined) {
    const file = mobileFile(value.android)
    const android = value.android as Record<string, unknown>
    if (!file || typeof android.versionCode !== 'number' || !Number.isSafeInteger(android.versionCode) || android.versionCode <= 0
      || typeof android.versionName !== 'string' || !VERSION.test(android.versionName) || !file.file.endsWith('.apk')) return null
    release.android = { ...file, versionCode: android.versionCode, versionName: android.versionName }
  }
  if (value.iphone !== undefined) {
    const file = mobileFile(value.iphone)
    if (!file || !file.file.endsWith('.zip')) return null
    release.iphone = file
  }
  if (!release.android && !release.iphone) return null
  if (release.android && release.iphone && release.android.file === release.iphone.file) return null
  return release
}

/** «0.6.0-80» before «0.6.0-81»; numbers compared as numbers. */
export function compareVersions(a: string, b: string) {
  const parts = (value: string) => value.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0
    const y = right[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

export interface MobileDownloadsOptions {
  dir: string
  repository?: string
  fetch?: typeof fetch
  now?: () => number
  log?: (message: string) => void
}

/** A visit to the downloads looks for a newer release at most this often; the server's timer checks too. */
export const CHECK_EVERY_MS = 10 * 60 * 1000

/** The copy of the newest mobile release on this server. */
export class MobileDownloads {
  private current: MobileRelease | null = null
  private loaded = false
  private refreshing: Promise<void> | null = null
  private checkedAt = Number.NEGATIVE_INFINITY
  private readonly now: () => number
  private readonly fetcher: typeof fetch
  private readonly repository: string
  private readonly log: (message: string) => void

  constructor(private readonly options: MobileDownloadsOptions) {
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.repository = options.repository ?? MOBILE_REPOSITORY
    this.log = options.log ?? (() => undefined)
  }

  /** The release this server serves now (read from disk once), or null. */
  async release(): Promise<MobileRelease | null> {
    if (!this.loaded) {
      this.loaded = true
      try {
        const saved = JSON.parse(await readFile(join(this.options.dir, CURRENT), 'utf8')) as { tag?: unknown; release?: unknown }
        const release = typeof saved.tag === 'string' ? parseMobileRelease(saved.release, saved.tag) : null
        if (release && await this.complete(release)) this.current = release
      } catch { /* nothing kept yet */ }
    }
    return this.current
  }

  /** Path of a file of the current release (the APK or the archive), or undefined. */
  async path(kind: 'android' | 'iphone') {
    const release = await this.release()
    const file = release?.[kind]
    return release && file ? { release, file, path: join(this.options.dir, release.tag, file.file) } : undefined
  }

  /**
   * Looks for a newer release on GitHub and copies it: one check at a time and at most one per CHECK_EVERY_MS (GitHub
   * answers 60 unauthenticated requests an hour), failures only logged. `force` skips the pause (the timer).
   */
  refresh(force = false) {
    const now = this.now()
    if (!force && !this.refreshing && now - this.checkedAt < CHECK_EVERY_MS) return Promise.resolve()
    if (!this.refreshing) this.checkedAt = now
    this.refreshing ??= this.check().catch((error: unknown) => this.log(`mobile downloads: ${error instanceof Error ? error.message : String(error)}`)).finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async complete(release: MobileRelease) {
    for (const file of [release.android, release.iphone]) {
      if (!file) continue
      try { if ((await stat(join(this.options.dir, release.tag, file.file))).size !== file.size) return false } catch { return false }
    }
    return true
  }

  private async getJson(url: string, limit: number) {
    const response = await this.fetcher(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RaidOS-mobile-downloads' }, signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > limit) throw new Error(`${url}: too large`)
    return JSON.parse(text) as unknown
  }

  private async check() {
    const current = await this.release()
    const releases = await this.getJson(`https://api.github.com/repos/${this.repository}/releases?per_page=20`, 2 * 1024 * 1024)
    if (!Array.isArray(releases)) throw new Error('unexpected releases answer')
    const assetsOf = (release: GithubRelease) => (Array.isArray(release.assets) ? release.assets as GithubAsset[] : [])
    const candidates = (releases as GithubRelease[])
      .filter((release) => typeof release.tag_name === 'string' && release.tag_name.startsWith(MOBILE_TAG_PREFIX) && release.draft !== true && release.prerelease !== true)
      .filter((release) => assetsOf(release).some((asset) => asset.name === MOBILE_MANIFEST))
      .sort((a, b) => compareVersions(String(b.tag_name).slice(MOBILE_TAG_PREFIX.length), String(a.tag_name).slice(MOBILE_TAG_PREFIX.length)))
    const newest = candidates[0]
    if (!newest) return
    const tag = String(newest.tag_name)
    if (current && compareVersions(tag.slice(MOBILE_TAG_PREFIX.length), current.version) <= 0) return
    const assets = new Map(assetsOf(newest).filter((asset) => typeof asset.name === 'string' && typeof asset.browser_download_url === 'string').map((asset) => [asset.name as string, asset]))
    const manifestUrl = String(assets.get(MOBILE_MANIFEST)?.browser_download_url)
    if (!manifestUrl.startsWith(`https://github.com/${this.repository}/releases/download/`)) throw new Error('unexpected manifest address')
    const release = parseMobileRelease(await this.getJson(manifestUrl, MAX_MANIFEST_BYTES), tag)
    if (!release) throw new Error(`${tag}: ${MOBILE_MANIFEST} is not a valid description`)

    const staging = join(this.options.dir, `.staging-${tag}`)
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    try {
      for (const file of [release.android, release.iphone]) {
        if (!file) continue
        const url = String(assets.get(file.file)?.browser_download_url ?? '')
        if (!url.startsWith(`https://github.com/${this.repository}/releases/download/`)) throw new Error(`${tag}: ${file.file} is not in the release`)
        await this.download(url, file, join(staging, file.file))
      }
      const target = join(this.options.dir, tag)
      await rm(target, { recursive: true, force: true })
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
    const next = join(this.options.dir, `${CURRENT}.next`)
    await writeFile(next, JSON.stringify({ tag, release }))
    await rename(next, join(this.options.dir, CURRENT))
    this.current = release
    this.log(`mobile downloads: ${tag} (${[release.android && 'Android', release.iphone && 'iPhone'].filter(Boolean).join(', ')})`)
    // Older copies go; a download of the previous one still in progress keeps its open file.
    for (const name of await readdir(this.options.dir)) {
      if (name !== tag && name !== CURRENT && (name.startsWith(MOBILE_TAG_PREFIX) || name.startsWith('.staging-'))) await rm(join(this.options.dir, name), { recursive: true, force: true })
    }
  }

  private async download(url: string, file: MobileFile, target: string) {
    const response = await this.fetcher(url, { headers: { 'User-Agent': 'RaidOS-mobile-downloads' }, signal: AbortSignal.timeout(15 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`${file.file}: HTTP ${response.status}`)
    const announced = Number(response.headers.get('content-length'))
    if (Number.isFinite(announced) && announced > 0 && announced !== file.size) throw new Error(`${file.file}: size differs`)
    const hash = createHash('sha256')
    let received = 0
    const source = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>)
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > file.size) source.destroy(new Error(`${file.file}: larger than described`))
      else hash.update(chunk)
    })
    await pipeline(source, createWriteStream(target, { mode: 0o644 }))
    if (received !== file.size || hash.digest('hex') !== file.sha256) throw new Error(`${file.file}: size or SHA-256 differs from ${MOBILE_MANIFEST}`)
  }
}
