import { createHash, type KeyObject } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { UPDATE_SIGNING_PUBLIC_KEY } from './updateSigningKey.js'
import { manifestParts, SERVER_UPDATE_FILE, verifiedServerUpdateManifest, type ClientVersionJson, type ServerUpdateManifest } from './serverUpdateManifest.js'

/**
 * «Автообновление сервера» (docs/laptop-server.md): the server laptop updates itself from a private GitHub repository
 * of releases (default proraa69-creator/raidos-releases) that the build session fills with scripts/publish-release.sh:
 *
 *   latest.json                        {"build": <build>, "path": "releases/<build>"}  (an unsigned pointer)
 *   releases/<build>/RaidOS-update.json the signed manifest (electron/serverUpdateManifest.ts)
 *   releases/<build>/RaidOS.partN, RaidOSClient.partN   the chat parts (≤ 25 MB each)
 *
 * This file is the part without Electron (tested in serverSelfUpdate.test.ts): reading the repository through the
 * GitHub REST contents API with a read-only token, downloading the parts into a staging folder (parts already there and
 * correct are kept, so an interrupted download goes on where it stopped), checking the manifest signature with the key
 * built into the app, every part's size and SHA-256 and the assembled exes; the install window; and the rule that
 * decides after the restart whether the new build is healthy or has to be rolled back (also written into the Windows
 * helper, helperScript()). electron/selfUpdate.ts wires it to the app: settings, timer, publishing, swap and restart.
 *
 * Nothing that is not covered by the signature is ever installed: latest.json only says where to look; the build it
 * names must equal the signed one, and only a build newer than the running one is taken (never a downgrade).
 */

export interface BuildRef { version: string; build: number; commit: string }
/**
 * When a verified release is installed: 'manual' (the default: downloaded and verified, then it waits for the owner's
 * «Установить сейчас»), 'any' (right away) or 'night' (03:00–06:00).
 */
export type InstallWindow = 'manual' | 'any' | 'night'
export const DEFAULT_INSTALL_WINDOW: InstallWindow = 'manual'
/** A saved setting → the install mode; anything that is not an explicit 'any' / 'night' (old settings, junk) is manual. */
export function installWindowOf(saved: unknown): InstallWindow {
  return saved === 'any' || saved === 'night' ? saved : DEFAULT_INSTALL_WINDOW
}
export const DEFAULT_RELEASES_REPO = 'proraa69-creator/raidos-releases'
export const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
export const CHECK_EVERY_MS = 15 * 60_000
/** «Только ночью»: 03:00–06:00 local time of the laptop. */
export const NIGHT_WINDOW = { fromHour: 3, toHour: 6 }
const MANIFEST_MAX_BYTES = 256 * 1024
const POINTER_MAX_BYTES = 4096

export function inInstallWindow(window: InstallWindow, at: Date) {
  if (window === 'manual') return false
  if (window !== 'night') return true
  const hour = at.getHours()
  return hour >= NIGHT_WINDOW.fromHour && hour < NIGHT_WINDOW.toHour
}

// --- the releases repository --------------------------------------------------------------------------------------

export interface LatestPointer { build: number; path: string }

/** latest.json: only a build number and its folder; anything else is refused. */
export function parseLatest(data: unknown): LatestPointer | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { build, path } = data as Record<string, unknown>
  if (typeof build !== 'number' || !Number.isSafeInteger(build) || build <= 0) return null
  if (path !== `releases/${build}`) return null
  return { build, path }
}

export class SourceError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** What the updater needs from a releases source (GitHubReleaseSource; tests pass a fake). */
export interface ReleaseSource {
  latest(etag?: string): Promise<{ notModified: true } | { notModified: false; etag?: string; pointer: LatestPointer }>
  text(path: string, maxBytes: number): Promise<string>
  download(path: string, file: string, expected: { size: number; sha256: string }, onBytes?: (bytes: number) => void): Promise<void>
}

const githubMessage = (status: number, what: string) => {
  if (status === 401) return 'GitHub отклонил токен (401): токен неверный или истёк. Создайте новый (Contents: Read-only, только этот репозиторий).'
  if (status === 403 || status === 429) return `GitHub не дал доступ к ${what} (HTTP ${status}): у токена нет права Contents: Read-only на этот репозиторий, или исчерпан лимит запросов.`
  if (status === 404) return `Не найдено на GitHub: ${what} (404). Проверьте имя репозитория и что токен выдан именно на него.`
  return `GitHub ответил HTTP ${status} на ${what}.`
}

/**
 * The private releases repository through the GitHub REST contents API (raw media type: files up to 100 MB; the parts
 * are ≤ 25 MB). Read-only fine-grained token, User-Agent and API version headers, a timeout on every request, ETag for
 * latest.json (an unchanged answer is a 304 that costs no rate limit).
 */
export class GitHubReleaseSource implements ReleaseSource {
  private readonly fetchImpl: typeof fetch
  constructor(private readonly opts: { repo: string; token: string; fetch?: typeof fetch; timeoutMs?: number; downloadTimeoutMs?: number; userAgent?: string }) {
    if (!REPO_PATTERN.test(opts.repo)) throw new Error('Репозиторий укажите как владелец/имя, например proraa69-creator/raidos-releases')
    this.fetchImpl = opts.fetch ?? fetch
  }

  private url(path: string) {
    return `https://api.github.com/repos/${this.opts.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`
  }

  private request(path: string, timeoutMs: number, extra: Record<string, string> = {}) {
    return this.fetchImpl(this.url(path), {
      headers: {
        accept: 'application/vnd.github.raw',
        authorization: `Bearer ${this.opts.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': this.opts.userAgent ?? 'RaidOS-server-updater',
        ...extra,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  async latest(etag?: string) {
    const response = await this.request('latest.json', this.opts.timeoutMs ?? 20_000, etag ? { 'if-none-match': etag } : {})
    if (response.status === 304) return { notModified: true as const }
    if (!response.ok) throw new SourceError(response.status, githubMessage(response.status, 'latest.json'))
    const text = await limitedText(response, POINTER_MAX_BYTES)
    let data: unknown
    try { data = JSON.parse(text) } catch { throw new SourceError(0, 'latest.json — не JSON') }
    const pointer = parseLatest(data)
    if (!pointer) throw new SourceError(0, 'latest.json должен быть {"build": <номер сборки>, "path": "releases/<номер сборки>"}')
    return { notModified: false as const, etag: response.headers.get('etag') ?? undefined, pointer }
  }

  async text(path: string, maxBytes: number) {
    const response = await this.request(path, this.opts.timeoutMs ?? 20_000)
    if (!response.ok) throw new SourceError(response.status, githubMessage(response.status, path))
    return limitedText(response, maxBytes)
  }

  async download(path: string, file: string, expected: { size: number; sha256: string }, onBytes?: (bytes: number) => void) {
    const response = await this.request(path, this.opts.downloadTimeoutMs ?? 10 * 60_000)
    if (!response.ok || !response.body) throw new SourceError(response.status, githubMessage(response.status, path))
    await writeVerified(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), file, expected, onBytes)
  }
}

async function limitedText(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new SourceError(0, `Файл больше ${maxBytes} байт`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxBytes) throw new SourceError(0, `Файл больше ${maxBytes} байт`)
  return buffer.toString('utf8')
}

/**
 * Streams bytes into `<file>.partial`, never more than the signed size, and renames it to `file` only when the size and
 * SHA-256 are exactly the signed ones; a wrong file is deleted.
 */
export async function writeVerified(stream: AsyncIterable<Uint8Array | Buffer | string>, file: string, expected: { size: number; sha256: string }, onBytes?: (bytes: number) => void) {
  const partial = `${file}.partial`
  const hash = createHash('sha256')
  let received = 0
  const out = createWriteStream(partial)
  const failed = new Promise<never>((_, reject) => out.once('error', reject))
  try {
    for await (const chunk of stream) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      received += buffer.length
      if (received > expected.size) throw new Error('файл больше, чем указано в подписанном манифесте')
      hash.update(buffer)
      if (!out.write(buffer)) await Promise.race([new Promise((resolve) => out.once('drain', resolve)), failed])
      onBytes?.(received)
    }
    await Promise.race([new Promise<void>((resolve) => out.end(resolve)), failed])
    if (received !== expected.size) throw new Error(`размер ${received} байт вместо ${expected.size}`)
    if (hash.digest('hex') !== expected.sha256) throw new Error('SHA-256 не совпадает с подписанным')
    await rename(partial, file)
  } catch (error) {
    out.destroy()
    await rm(partial, { force: true }).catch(() => {})
    throw error
  }
}

export async function fileDigest(file: string) {
  const info = await stat(file)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return { size: info.size, sha256: hash.digest('hex') }
}

// --- the staged release -------------------------------------------------------------------------------------------

export interface Check { label: string; ok: boolean; detail?: string }
export interface StagedRelease { dir: string; manifest: ServerUpdateManifest; ownerExe: string; clientExe: string | null; versionJson: ClientVersionJson | null; checks: Check[] }

export const STAGED = { owner: 'owner.exe', client: 'client.exe', versionJson: 'version.json' }

/** The manifest in a staging folder when its signature verifies with `publicKey` (the key built into the app). */
export async function readStagedManifest(dir: string, publicKey: string | KeyObject = UPDATE_SIGNING_PUBLIC_KEY) {
  let data: unknown
  try { data = JSON.parse(await readFile(join(dir, SERVER_UPDATE_FILE), 'utf8')) } catch { return null }
  return verifiedServerUpdateManifest(data, publicKey)
}

/** Joins the parts of one exe into `target`, hashing on the way; throws unless size and SHA-256 are the signed ones. */
async function assembleExe(dir: string, parts: Array<{ name: string }>, target: string, expected: { size: number; sha256: string }) {
  async function* joined() {
    for (const part of parts) for await (const chunk of createReadStream(join(dir, part.name))) yield chunk as Buffer
  }
  await writeVerified(joined(), target, expected)
}

/**
 * Checks a staging folder from scratch: the manifest signature (embedded key), every part, then joins and checks both
 * exes and writes the players' version.json. Run when the download is complete and again right before installing, so
 * a file changed in between is caught. Throws with the first failure; `checks` lists what passed.
 */
export async function verifyStagedRelease(dir: string, publicKey: string | KeyObject = UPDATE_SIGNING_PUBLIC_KEY, options: { assemble?: boolean } = {}): Promise<StagedRelease> {
  const checks: Check[] = []
  const fail = (label: string, detail: string): never => {
    checks.push({ label, ok: false, detail })
    throw Object.assign(new Error(`${label}: ${detail}`), { checks })
  }
  const manifest = await readStagedManifest(dir, publicKey)
  if (!manifest) fail('Подпись манифеста', 'не сходится с ключом, встроенным в приложение — установка запрещена')
  const signed = manifest as ServerUpdateManifest
  checks.push({ label: 'Подпись манифеста', ok: true, detail: `сборка ${signed.version} (${signed.build})` })
  for (const part of manifestParts(signed)) {
    const digest = await fileDigest(join(dir, part.name)).catch(() => null)
    if (!digest) fail(part.name, 'файла нет')
    if (digest!.size !== part.size || digest!.sha256 !== part.sha256) fail(part.name, 'размер или SHA-256 не совпадает с подписанным')
    checks.push({ label: part.name, ok: true })
  }
  const ownerExe = join(dir, STAGED.owner)
  const clientExe = signed.client ? join(dir, STAGED.client) : null
  if (options.assemble !== false) {
    await assembleExe(dir, signed.owner.parts, ownerExe, signed.owner).catch((error: unknown) => fail('Сервер (exe владельца)', error instanceof Error ? error.message : String(error)))
  } else {
    const digest = await fileDigest(ownerExe).catch(() => null)
    if (!digest || digest.size !== signed.owner.size || digest.sha256 !== signed.owner.sha256) fail('Сервер (exe владельца)', 'собранный файл не совпадает с подписанным')
  }
  checks.push({ label: 'Сервер (exe владельца)', ok: true, detail: `${signed.owner.size} байт, SHA-256 совпадает` })
  if (signed.client && clientExe) {
    if (options.assemble !== false) {
      await assembleExe(dir, signed.client.parts, clientExe, signed.client).catch((error: unknown) => fail('Версия для игроков', error instanceof Error ? error.message : String(error)))
      await writeFile(join(dir, STAGED.versionJson), `${JSON.stringify(signed.client.versionJson)}\n`)
    } else {
      const digest = await fileDigest(clientExe).catch(() => null)
      if (!digest || digest.size !== signed.client.size || digest.sha256 !== signed.client.sha256) fail('Версия для игроков', 'собранный файл не совпадает с подписанным')
    }
    checks.push({ label: 'Версия для игроков', ok: true, detail: `${signed.client.versionJson.version}, подпись version.json верна` })
  }
  return { dir, manifest: signed, ownerExe, clientExe, versionJson: signed.client?.versionJson ?? null, checks }
}

// --- the updater ------------------------------------------------------------------------------------------------

export type UpdaterPhase = 'off' | 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'
export interface FileProgress { name: string; size: number; done: number; state: 'pending' | 'downloading' | 'ok' | 'error' }
export interface UpdaterStatus {
  phase: UpdaterPhase
  /** Short Russian line for the panels. */
  message: string
  checkedAt?: string
  latest?: BuildRef
  files: FileProgress[]
  checks: Check[]
  error?: string
  /** A verified build waits for the install window («только ночью»). */
  waitingForWindow?: boolean
  /** A verified build waits for the owner's «Установить сейчас» (install mode 'manual'). */
  waitingForInstall?: boolean
}
export type CheckOutcome = 'off' | 'busy' | 'latest' | 'skipped' | 'waiting' | 'installing' | 'error'
export const READY_FOR_INSTALL_TEXT = 'Скачано и проверено, ждёт установки'

export interface UpdaterOptions {
  /** Staging root: one sub-folder per build. */
  root: string
  current: () => Promise<BuildRef> | BuildRef
  /** null when the repository or the token is not set. */
  source: () => Promise<ReleaseSource | null> | ReleaseSource | null
  settings: () => Promise<{ enabled: boolean; window: InstallWindow }> | { enabled: boolean; window: InstallWindow }
  /** Builds never to install automatically again (rolled back after a failed health check or by the owner). */
  skipped: () => Promise<number[]> | number[]
  /** Publishes, swaps and restarts (electron/selfUpdate.ts). Called only with a fully verified release. */
  install: (release: StagedRelease) => Promise<void>
  onStatus?: (status: UpdaterStatus) => void
  now?: () => Date
  /** Tests only: the app always checks with the key built into it. */
  publicKey?: string | KeyObject
}

export class ServerSelfUpdater {
  private status: UpdaterStatus = { phase: 'idle', message: 'ещё не проверялось', files: [], checks: [] }
  private running: Promise<CheckOutcome> | null = null
  private etag: string | undefined
  private pointer: LatestPointer | undefined
  private ready: StagedRelease | null = null

  constructor(private readonly opts: UpdaterOptions) {}

  snapshot(): UpdaterStatus {
    return { ...this.status, files: this.status.files.map((file) => ({ ...file })), checks: [...this.status.checks] }
  }

  private set(patch: Partial<UpdaterStatus>) {
    this.status = { ...this.status, ...patch }
    try { this.opts.onStatus?.(this.snapshot()) } catch { /* the listener's problem */ }
  }

  /** One check (timer or «Проверить сейчас»); a second call while one runs waits for it. */
  check(): Promise<CheckOutcome> {
    this.running ??= this.run().finally(() => { this.running = null })
    return this.running
  }

  /** The verified build waiting to be installed (manual mode or outside the night window), if any. */
  readyBuild(): BuildRef | null {
    const manifest = this.ready?.manifest
    return manifest ? { version: manifest.version, build: manifest.build, commit: manifest.commit } : null
  }

  /**
   * «Установить сейчас»: installs the build that was downloaded and verified (any install mode), after a check that is
   * running has finished. Rejects when nothing is ready; an install failure ends as phase 'error' (outcome 'error').
   */
  async installNow(): Promise<CheckOutcome> {
    while (this.running) await this.running.catch(() => undefined)
    if (!this.ready) throw new Error('Нет скачанной и проверенной версии: нажмите «Проверить сейчас» и дождитесь «Скачано и проверено, ждёт установки»')
    const release = this.ready
    this.running = this.installRelease(release, (this.opts.now ?? (() => new Date()))().toISOString()).catch((error: unknown) => this.failed(error)).finally(() => { this.running = null })
    return this.running
  }

  private failed(error: unknown): CheckOutcome {
    const message = error instanceof Error ? error.message : String(error)
    const checks = (error as { checks?: Check[] }).checks
    this.set({ phase: 'error', message: 'ошибка', error: message, checkedAt: (this.opts.now ?? (() => new Date()))().toISOString(), ...(checks ? { checks } : {}) })
    return 'error'
  }

  private async installRelease(release: StagedRelease, checkedAt: string): Promise<CheckOutcome> {
    if ((await this.opts.skipped()).includes(release.manifest.build)) throw new Error(`Сборка ${release.manifest.build} была откачена и больше не ставится автоматически`)
    this.set({ phase: 'installing', message: `устанавливаю ${release.manifest.version}…`, checkedAt, waitingForWindow: undefined, waitingForInstall: undefined, error: undefined })
    // Again from scratch right before installing: a file changed since the download is caught here.
    const fresh = await verifyStagedRelease(release.dir, this.opts.publicKey ?? UPDATE_SIGNING_PUBLIC_KEY, { assemble: false })
    if (fresh.manifest.build <= (await this.opts.current()).build) throw new Error('Сборка не новее установленной: откат версии автоматически не выполняется')
    await this.opts.install(fresh)
    this.ready = null
    return 'installing'
  }

  private async run(): Promise<CheckOutcome> {
    const now = () => (this.opts.now ?? (() => new Date()))()
    const settings = await this.opts.settings()
    if (!settings.enabled) { this.ready = null; this.set({ phase: 'off', message: 'выключено', error: undefined, files: [], checks: [], waitingForWindow: undefined, waitingForInstall: undefined }); return 'off' }
    const source = await this.opts.source()
    if (!source) { this.set({ phase: 'error', message: 'не настроено', error: 'Укажите репозиторий релизов и токен GitHub.', checkedAt: now().toISOString() }); return 'error' }
    this.set({ phase: 'checking', message: 'проверяю…', error: undefined })
    try {
      const current = await this.opts.current()
      const answer = await source.latest(this.pointer ? this.etag : undefined)
      if (!answer.notModified) { this.etag = answer.etag; this.pointer = answer.pointer }
      const pointer = this.pointer
      const checkedAt = now().toISOString()
      if (!pointer) throw new Error('latest.json не прочитан')
      if (pointer.build <= current.build) {
        this.ready = null
        this.set({ phase: 'idle', message: pointer.build === current.build ? 'установлена последняя версия' : 'на GitHub сборка не новее установленной — пропущено', checkedAt, files: [], checks: [], waitingForWindow: undefined, waitingForInstall: undefined, latest: undefined })
        return 'latest'
      }
      if ((await this.opts.skipped()).includes(pointer.build)) {
        this.ready = null
        this.set({ phase: 'idle', message: `сборка ${pointer.build} была откачена и больше не ставится автоматически`, checkedAt, files: [], checks: [], waitingForWindow: undefined, waitingForInstall: undefined })
        return 'skipped'
      }
      let release = this.ready?.manifest.build === pointer.build ? this.ready : null
      if (!release) release = await this.fetchRelease(source, pointer, current)
      this.ready = release
      if (settings.window === 'manual') {
        this.set({ phase: 'ready', message: `сборка ${release.manifest.version} (${release.manifest.build}): ${READY_FOR_INSTALL_TEXT.toLowerCase()} («Установить сейчас»)`, checkedAt, waitingForWindow: undefined, waitingForInstall: true })
        return 'waiting'
      }
      if (!inInstallWindow(settings.window, now())) {
        this.set({ phase: 'ready', message: `сборка ${release.manifest.version} скачана и проверена, установка ночью (03:00–06:00)`, checkedAt, waitingForWindow: true, waitingForInstall: undefined })
        return 'waiting'
      }
      return await this.installRelease(release, checkedAt)
    } catch (error) {
      return this.failed(error)
    }
  }

  /** Downloads what is missing into <root>/<build>/ and verifies everything. Older staging folders are removed. */
  private async fetchRelease(source: ReleaseSource, pointer: LatestPointer, current: BuildRef): Promise<StagedRelease> {
    const publicKey = this.opts.publicKey ?? UPDATE_SIGNING_PUBLIC_KEY
    const dir = join(this.opts.root, String(pointer.build))
    await mkdir(dir, { recursive: true })
    for (const name of await readdir(this.opts.root).catch(() => [] as string[])) {
      if (name !== String(pointer.build)) await rm(join(this.opts.root, name), { recursive: true, force: true }).catch(() => {})
    }
    const text = await source.text(`${pointer.path}/${SERVER_UPDATE_FILE}`, MANIFEST_MAX_BYTES)
    let data: unknown
    try { data = JSON.parse(text) } catch { throw new Error(`${SERVER_UPDATE_FILE} — не JSON`) }
    const manifest = verifiedServerUpdateManifest(data, publicKey)
    if (!manifest) {
      this.set({ checks: [{ label: 'Подпись манифеста', ok: false, detail: 'не сходится с ключом, встроенным в приложение' }] })
      throw new Error('Подпись RaidOS-update.json не сходится с ключом, встроенным в приложение. Ничего не скачано и не установлено.')
    }
    if (manifest.build !== pointer.build) throw new Error(`latest.json указывает сборку ${pointer.build}, а подписан манифест сборки ${manifest.build}`)
    if (manifest.build <= current.build) throw new Error('Подписанная сборка не новее установленной: откат версии автоматически не выполняется')
    await writeFile(join(dir, SERVER_UPDATE_FILE), text)
    const parts = manifestParts(manifest)
    const files: FileProgress[] = parts.map((part) => ({ name: part.name, size: part.size, done: 0, state: 'pending' }))
    const latest = { version: manifest.version, build: manifest.build, commit: manifest.commit }
    this.set({ phase: 'downloading', message: `скачиваю ${manifest.version}…`, latest, files, checks: [{ label: 'Подпись манифеста', ok: true, detail: `сборка ${manifest.version} (${manifest.build})` }] })
    for (const [index, part] of parts.entries()) {
      const file = join(dir, part.name)
      const have = await fileDigest(file).catch(() => null)
      if (have && have.size === part.size && have.sha256 === part.sha256) {
        files[index] = { ...files[index]!, done: part.size, state: 'ok' }
        this.set({ files })
        continue
      }
      await rm(file, { force: true }).catch(() => {})
      files[index] = { ...files[index]!, state: 'downloading' }
      this.set({ files })
      let shown = 0
      try {
        await source.download(`${pointer.path}/${part.name}`, file, part, (bytes) => {
          if (bytes - shown < 1024 * 1024 && bytes !== part.size) return
          shown = bytes
          files[index] = { ...files[index]!, done: bytes }
          this.set({ files })
        })
      } catch (error) {
        files[index] = { ...files[index]!, state: 'error' }
        this.set({ files })
        throw new Error(`${part.name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
      files[index] = { ...files[index]!, done: part.size, state: 'ok' }
      this.set({ files })
    }
    this.set({ phase: 'verifying', message: 'проверяю подпись и контрольные суммы…' })
    const release = await verifyStagedRelease(dir, publicKey)
    this.set({ checks: release.checks })
    return release
  }
}

// --- after the restart: healthy or roll back ----------------------------------------------------------------------

/** The new build has 2 minutes to answer: the API's /health with the expected build, and the site, twice in a row. */
export const HEALTH_RULES = { deadlineMs: 120_000, intervalMs: 3_000, okInARow: 2 }

export interface HealthObservation {
  /** The API's /health on 127.0.0.1:8787 (a direct local request also reports `build`); null = no answer. */
  api: { ok: boolean; build?: number } | null
  siteOk: boolean
}
export type HealthReason = 'api-not-responding' | 'api-unhealthy' | 'wrong-build' | 'site-not-responding'
export interface HealthState { startedAt: number; okStreak: number; lastReason?: HealthReason }
export interface HealthVerdict { verdict: 'healthy' | 'wait' | 'rollback'; state: HealthState; reason?: HealthReason }

export type HelperFailure = 'swap-failed' | 'start-failed' | 'helper-lost' | 'helper-not-started'
export const HEALTH_REASON_TEXT: Record<HealthReason | HelperFailure, string> = {
  'api-not-responding': 'сервер (API) новой версии не ответил за 2 минуты',
  'api-unhealthy': 'сервер (API) новой версии отвечает с ошибкой (база данных?)',
  'wrong-build': 'на порту сервера отвечает другая сборка',
  'site-not-responding': 'сайт новой версии не открылся за 2 минуты',
  'swap-failed': 'не удалось заменить exe (файл занят)',
  'start-failed': 'новая версия не запустилась',
  'helper-lost': 'помощник обновления пропал, не записав итог (закрыт, заблокирован антивирусом или ноутбук перезагрузился) — см. update-helper.log',
  'helper-not-started': 'помощник обновления не запустился (PowerShell заблокирован?) — обновление отменено, сервер остался в прежней версии',
}

/**
 * One observation after the restart (pure; the PowerShell helper applies the same rule, see helperScript): healthy once
 * the expected build's API and the site answered `okInARow` times in a row; rollback when the deadline passes first.
 */
export function healthVerdict(state: HealthState, observation: HealthObservation, expectedBuild: number, now: number, rules = HEALTH_RULES): HealthVerdict {
  let reason: HealthReason | undefined
  if (!observation.api) reason = 'api-not-responding'
  else if (!observation.api.ok) reason = 'api-unhealthy'
  else if (observation.api.build !== expectedBuild) reason = 'wrong-build'
  else if (!observation.siteOk) reason = 'site-not-responding'
  const okStreak = reason ? 0 : state.okStreak + 1
  const next: HealthState = { startedAt: state.startedAt, okStreak, ...(reason ? { lastReason: reason } : state.lastReason ? { lastReason: state.lastReason } : {}) }
  if (!reason && okStreak >= rules.okInARow) return { verdict: 'healthy', state: next }
  if (now - state.startedAt >= rules.deadlineMs) return { verdict: 'rollback', state: next, reason: reason ?? next.lastReason ?? 'api-not-responding' }
  return { verdict: 'wait', state: next }
}

/** The flags the laptop runs with; only these are passed to the restarted exe. */
export function restartArgs(argv: string[]) {
  const args = ['--server-mode']
  if (argv.includes('--enable-tunnel')) args.push('--enable-tunnel')
  return args
}

/**
 * Environment of the helper (paths travel in variables: PowerShell reads them correctly with any folder name, which a
 * script's own text might garble).
 */
export interface HelperPlan {
  /** Id of this restart (state.json `id`): the helper does nothing once state.json no longer carries it (cancelled). */
  id: string
  /** The running portable exe (PORTABLE_EXECUTABLE_FILE, the electron-builder wrapper) that gets replaced. */
  exe: string
  /** The verified new exe next to it (`<exe>.update`). */
  next: string
  /** The copy of the exe that ran before, restored on rollback. */
  previous: string
  /** Players' version folder and the copy of what was published there before (restored on rollback); '' = none. */
  clientDir: string
  clientPrevious: string
  /** helper → app: result.json (ASCII), app → helper: confirm.json (the new build's own health check). */
  resultFile: string
  confirmFile: string
  /** state.json: the pending restart (the helper checks its id to know it was not cancelled). */
  pendingFile: string
  /** update-helper.log: the helper's timestamped log of every step (and update-helper.transcript.log next to it). */
  logFile: string
  /** helper.pid: {"id", "pid"} written by the helper as soon as it runs (the app waits for it before quitting). */
  helperPidFile: string
  /** app.pid: {"pid", "exe"} written by the restarted app, so the helper can stop exactly that process on rollback. */
  appPidFile: string
  /** The unpacked inner exe (process.execPath, in %TEMP%) and its pid: this copy of the app. */
  appExe: string
  pid: number
  expectedBuild: number
  args: string[]
}

export function helperEnvironment(plan: HelperPlan): Record<string, string> {
  return {
    RAIDOS_ID: plan.id, RAIDOS_EXE: plan.exe, RAIDOS_NEXT: plan.next, RAIDOS_PREVIOUS: plan.previous, RAIDOS_CLIENT_DIR: plan.clientDir, RAIDOS_CLIENT_PREVIOUS: plan.clientPrevious,
    RAIDOS_RESULT: plan.resultFile, RAIDOS_CONFIRM: plan.confirmFile, RAIDOS_PENDING: plan.pendingFile, RAIDOS_LOG: plan.logFile,
    RAIDOS_HELPER_PID: plan.helperPidFile, RAIDOS_APP_PID: plan.appPidFile, RAIDOS_APP_EXE: plan.appExe, RAIDOS_PID: String(plan.pid),
    RAIDOS_BUILD: String(plan.expectedBuild), RAIDOS_ARGS: restartArgs(plan.args).join(' '),
  }
}

/** How long the helper waits for this copy (inner exe and wrapper) to quit before it stops both itself. */
export const HELPER_QUIT_TIMEOUT_SEC = 90
/** How long Start-Server waits for the started exe to show up as a process. */
export const HELPER_START_VERIFY_SEC = 30

/**
 * The tiny launcher run by the app (powershell -EncodedCommand, no paths on the command line): it starts the helper with
 * Start-Process and exits at once, so the helper is not a child of the app (not in its process tree or job object,
 * not killed with it) and survives the app's quit and the portable wrapper's clean-up. It logs its own outcome.
 */
export function launcherScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$enc = New-Object System.Text.UTF8Encoding($false)',
    "function Log($text) { try { [System.IO.File]::AppendAllText($env:RAIDOS_LOG, ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff') + ' [launcher] ' + $text + [Environment]::NewLine), $enc) } catch {} }",
    'try {',
    "  $p = Start-Process -FilePath $env:RAIDOS_POWERSHELL -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('\"' + $env:RAIDOS_HELPER + '\"')) -WindowStyle Hidden -PassThru",
    "  Log ('helper process started, pid ' + $p.Id)",
    '} catch {',
    "  Log ('Start-Process of the helper failed: ' + $_.Exception.Message)",
    '  exit 1',
    '}',
  ].join('\n')
}

/** powershell -EncodedCommand takes UTF-16LE in base64. */
export function encodedCommand(script: string) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** The last lines of update-helper.log for the history and the GitHub report (the reporter sanitizes it again). */
export function helperLogTail(text: string, maxLines = 60, maxChars = 6000) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  const tail = lines.slice(-maxLines).join('\n')
  return tail.length > maxChars ? tail.slice(tail.length - maxChars) : tail
}

/**
 * The Windows helper (PowerShell 5.1, written with a UTF-8 BOM, started hidden through launcherScript) that runs after
 * this copy quits. The app is an electron-builder PORTABLE exe: RAIDOS_EXE is the wrapper, RAIDOS_PID / RAIDOS_APP_EXE
 * the inner app it unpacked into %TEMP% (the wrapper deletes that folder after the inner app exits). The helper:
 *   1. writes helper.pid at once (the app waits for it before quitting; no pid file = the app cancels and stays up);
 *   2. waits for BOTH the inner pid and the wrapper (process with Path = RAIDOS_EXE) to exit, stops both after
 *      HELPER_QUIT_TIMEOUT_SEC; does nothing if the app cancelled the restart (state.json without this id);
 *   3. moves the verified new exe over the old one, starts it with the same flags and verifies within
 *      HELPER_START_VERIFY_SEC that the process exists;
 *   4. for 2 minutes checks the new build (healthVerdict's rule; the new build also confirms itself via confirm.json).
 *      Not healthy in time: stops it (wrapper tree + the pid from app.pid), restores the previous exe and the previous
 *      players' version, starts the previous exe and shows a Windows notification.
 * Every step goes to update-helper.log with a timestamp (plus a PowerShell transcript); the app shows its tail in the
 * history and the GitHub report. result.json gets only ASCII codes; the app turns them into text on its next start.
 */
export function helperScript(rules = HEALTH_RULES) {
  return `# Raid OS server self-update helper (electron/serverSelfUpdate.ts helperScript). Paths come from environment variables.
$ErrorActionPreference = 'Continue'
$planId = $env:RAIDOS_ID; $exe = $env:RAIDOS_EXE; $next = $env:RAIDOS_NEXT; $prev = $env:RAIDOS_PREVIOUS
$clientDir = $env:RAIDOS_CLIENT_DIR; $clientPrev = $env:RAIDOS_CLIENT_PREVIOUS
$resultFile = $env:RAIDOS_RESULT; $confirmFile = $env:RAIDOS_CONFIRM; $pendingFile = $env:RAIDOS_PENDING
$logFile = $env:RAIDOS_LOG; $helperPidFile = $env:RAIDOS_HELPER_PID; $appPidFile = $env:RAIDOS_APP_PID
$oldPid = [int]$env:RAIDOS_PID; $oldAppExe = $env:RAIDOS_APP_EXE
$expected = [int64]$env:RAIDOS_BUILD; $argsLine = $env:RAIDOS_ARGS
$deadlineSec = ${Math.round(rules.deadlineMs / 1000)}; $intervalSec = ${Math.round(rules.intervalMs / 1000)}; $okInARow = ${rules.okInARow}
$quitTimeoutSec = ${HELPER_QUIT_TIMEOUT_SEC}; $startVerifySec = ${HELPER_START_VERIFY_SEC}
$enc = New-Object System.Text.UTF8Encoding($false)

function Log($text) {
  try { [System.IO.File]::AppendAllText($logFile, ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff') + ' [helper] ' + $text + [Environment]::NewLine), $enc) } catch {}
}
trap { Log ('ERROR: ' + $_.Exception.Message + ' (line ' + $_.InvocationInfo.ScriptLineNumber + ')'); continue }
try { [System.IO.File]::WriteAllText($helperPidFile, ('{"id":"' + $planId + '","pid":' + $PID + '}'), $enc) } catch { Log ('could not write helper.pid: ' + $_.Exception.Message) }
try { Start-Transcript -LiteralPath ($logFile -replace '\\.log$', '.transcript.log') -Append -ErrorAction Stop | Out-Null } catch { Log ('no transcript: ' + $_.Exception.Message) }
Log ('started: pid ' + $PID + ', PowerShell ' + $PSVersionTable.PSVersion + ', restart ' + $planId + ', expected build ' + $expected + ', args ' + $argsLine)

function Write-Result($phase, $reason, $detail) {
  $data = @{ phase = $phase; reason = $reason; detail = $detail; build = $expected; at = (Get-Date).ToUniversalTime().ToString('o') }
  try { [System.IO.File]::WriteAllText($resultFile, ($data | ConvertTo-Json -Compress), $enc); Log ('result: ' + $phase + ' ' + $reason + ' ' + $detail) } catch { Log ('could not write result.json: ' + $_.Exception.Message) }
}
function Test-Cancelled {
  try { $state = Get-Content -LiteralPath $pendingFile -Raw -ErrorAction Stop | ConvertFrom-Json; return ([string]$state.id -ne $planId) } catch { return $true }
}
function Notify($title, $text) {
  try {
    Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Warning; $icon.Visible = $true
    $icon.ShowBalloonTip(15000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Warning)
    Start-Sleep -Seconds 16; $icon.Dispose()
  } catch { Log ('notification failed: ' + $_.Exception.Message) }
}
function Get-ByPath($path) {
  if (-not $path) { return @() }
  return @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and ($_.Path -eq $path) } catch { $false } })
}
# This copy: the inner exe (only while that pid still runs that exe: pids are reused) and the portable wrapper.
function Get-OldApp {
  $list = @()
  $inner = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
  if ($inner) { try { if (-not $oldAppExe -or $inner.Path -eq $oldAppExe) { $list += $inner } } catch {} }
  $list += @(Get-ByPath $exe)
  return @($list | Where-Object { $_ })
}
# The restarted copy: the wrapper and the inner pid it wrote into app.pid (its Electron child processes share its path).
function Get-NewApp {
  $list = @(Get-ByPath $exe)
  try {
    $info = Get-Content -LiteralPath $appPidFile -Raw -ErrorAction Stop | ConvertFrom-Json
    $list += @(Get-ByPath ([string]$info.exe))
  } catch {}
  return @($list | Where-Object { $_ } | Sort-Object Id -Unique)
}
function Stop-Tree($procId, $force) {
  $targs = @('/PID', [string]$procId, '/T'); if ($force) { $targs += '/F' }
  $out = & (Join-Path $env:SystemRoot 'System32\\taskkill.exe') @targs 2>&1 | Out-String
  Log ('taskkill ' + ($targs -join ' ') + ': exit ' + $LASTEXITCODE + ' ' + $out.Trim())
}
function Stop-Processes($label, $getter) {
  $targets = @(& $getter)
  Log ('stopping ' + $label + ': ' + (($targets | ForEach-Object { [string]$_.Id + ' ' + $_.ProcessName }) -join ', '))
  foreach ($p in $targets) { Stop-Tree $p.Id $false }
  for ($i = 0; $i -lt 8; $i++) { if (@(& $getter).Count -eq 0) { break }; Start-Sleep -Seconds 1 }
  foreach ($p in @(& $getter)) { Stop-Tree $p.Id $true; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $left = @(& $getter)
  if ($left.Count -gt 0) { Log ('still running after stop: ' + (($left | ForEach-Object { $_.Id }) -join ', ')) } else { Log ($label + ' stopped') }
}
function Stop-App { Stop-Processes 'the running server' { Get-NewApp } }
function Copy-Retry($from, $to) {
  for ($i = 0; $i -lt 60; $i++) {
    try { Copy-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop; Log ('copied ' + $from + ' -> ' + $to); return $true }
    catch { if ($i % 10 -eq 0) { Log ('copy attempt ' + ($i + 1) + ' failed: ' + $_.Exception.Message) }; Start-Sleep -Seconds 1 }
  }
  Log ('copy failed for 60 s: ' + $from + ' -> ' + $to)
  return $false
}
# Starts the exe and checks within $startVerifySec that a process with that path really exists.
function Start-Server($label) {
  Log ('starting ' + $label + ': ' + $exe + ' ' + $argsLine)
  try {
    $p = Start-Process -FilePath $exe -ArgumentList $argsLine -WorkingDirectory (Split-Path -Parent $exe) -PassThru -ErrorAction Stop
    Log ('Start-Process ok: pid ' + $p.Id)
  } catch { Log ('Start-Process failed: ' + $_.Exception.Message); return $false }
  for ($i = 1; $i -le $startVerifySec; $i++) {
    Start-Sleep -Seconds 1
    $seen = @(Get-ByPath $exe)
    if ($seen.Count -gt 0) { Log ('process is running after ' + $i + ' s: pid ' + (($seen | ForEach-Object { $_.Id }) -join ', ')); return $true }
    if ($i % 10 -eq 0) { Log ('no process yet after ' + $i + ' s (Start-Process pid ' + $p.Id + ', exited: ' + $p.HasExited + ')') }
  }
  Log ('no process with the path ' + $exe + ' appeared within ' + $startVerifySec + ' s')
  return $false
}
function Roll-Back($reason, $detail) {
  Log ('ROLLBACK: ' + $reason + ' ' + $detail)
  Write-Result 'rolling-back' $reason $detail
  Stop-App
  $restored = Copy-Retry $prev $exe
  if ($clientDir -and $clientPrev -and (Test-Path -LiteralPath $clientPrev)) {
    Get-ChildItem -LiteralPath $clientDir -Filter *.exe -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $clientDir 'version.json') -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $clientPrev -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $clientDir -Force -ErrorAction SilentlyContinue }
    Log 'players version restored from previous\\client'
  }
  if ($restored) { Write-Result 'rolled-back' $reason $detail } else { Write-Result 'failed' 'restore-failed' $detail }
  $null = Start-Server 'the previous version'
  Log 'helper finished (rollback)'
  Notify 'Raid OS: обновление откачено' 'Новая версия сервера не прошла проверку за 2 минуты. Возвращена предыдущая версия. Подробности: Админ-панель -> Обновление.'
  exit 1
}

if (Test-Cancelled) { Log 'state.json no longer has this restart: the app cancelled it, nothing is changed'; exit 0 }

# 1. Wait until this copy has quit: the inner exe AND the portable wrapper (it deletes its temp folder after the inner exe).
Log ('waiting for the app to quit: inner pid ' + $oldPid + ' (' + $oldAppExe + ') and the wrapper (' + $exe + ')')
$waitStart = Get-Date; $lastNote = 0; $forced = $false
while ($true) {
  $alive = @(Get-OldApp)
  if ($alive.Count -eq 0) { break }
  $sec = [int]((Get-Date) - $waitStart).TotalSeconds
  if (Test-Cancelled) { Log 'the app cancelled the restart while it was quitting: nothing is changed'; exit 0 }
  if ($sec -ge $quitTimeoutSec -and -not $forced) {
    Log ('the app did not quit within ' + $quitTimeoutSec + ' s')
    Stop-Processes 'the old app (inner exe and wrapper)' { Get-OldApp }
    $forced = $true
  } elseif ($sec -ge ($quitTimeoutSec + 30)) {
    Log 'the old app cannot be stopped: the exe is not replaced'
    Write-Result 'failed' 'swap-failed' 'old app still running'
    exit 1
  }
  if ($sec - $lastNote -ge 10) { Log ('still running: ' + (($alive | ForEach-Object { [string]$_.Id + ' ' + $_.ProcessName }) -join ', ')); $lastNote = $sec }
  Start-Sleep -Milliseconds 500
}
Log ('the app has quit after ' + [int]((Get-Date) - $waitStart).TotalSeconds + ' s')
Start-Sleep -Seconds 2

# 2. Swap.
if (-not (Test-Path -LiteralPath $next)) { Log ('the new exe is missing: ' + $next) }
$moved = $false; $moveError = ''
for ($i = 0; $i -lt 60; $i++) {
  try { Move-Item -LiteralPath $next -Destination $exe -Force -ErrorAction Stop; $moved = $true; break }
  catch { $moveError = $_.Exception.Message; if ($i % 10 -eq 0) { Log ('move attempt ' + ($i + 1) + ' failed: ' + $moveError) }; Start-Sleep -Seconds 1 }
}
if (-not $moved) {
  Log ('move failed for 60 s: ' + $moveError)
  Write-Result 'failed' 'swap-failed' ''
  $null = Start-Server 'the old version (swap failed)'
  Notify 'Raid OS: обновление не установлено' 'Не удалось заменить exe сервера (файл занят). Сервер запущен в прежней версии.'
  exit 1
}
Log ('moved the new exe into place (' + (Get-Item -LiteralPath $exe).Length + ' bytes)')

# 3. Start and check that it runs.
Write-Result 'checking' '' ''
if (-not (Start-Server 'the new version')) { Roll-Back 'start-failed' 'no process after Start-Process' }

# 4. Health: the new build confirms itself (confirm.json) or answers /health with its build and the site, twice in a row.
$started = Get-Date; $okStreak = 0; $last = 'api-not-responding'; $probe = 0
while (((Get-Date) - $started).TotalSeconds -lt $deadlineSec) {
  Start-Sleep -Seconds $intervalSec
  $probe++
  try {
    $confirm = Get-Content -LiteralPath $confirmFile -Raw -ErrorAction Stop | ConvertFrom-Json
    if ([int64]$confirm.build -eq $expected) { Log ('probe ' + $probe + ': the new build confirmed itself'); Write-Result 'ok' '' 'confirmed'; Log 'helper finished (ok)'; exit 0 }
  } catch {}
  $reason = ''; $apiNote = ''
  try {
    $api = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 4 -Headers @{ 'Cache-Control' = 'no-cache' }
    $apiNote = 'ok=' + $api.ok + ' build=' + $api.build.build
    if (-not $api.ok) { $reason = 'api-unhealthy' } elseif ([int64]$api.build.build -ne $expected) { $reason = 'wrong-build' }
  } catch { $reason = 'api-not-responding'; $apiNote = $_.Exception.Message }
  if (-not $reason) {
    try { $site = Invoke-WebRequest -Uri 'http://127.0.0.1:5202/' -UseBasicParsing -TimeoutSec 4; if ($site.StatusCode -ne 200) { $reason = 'site-not-responding' } } catch { $reason = 'site-not-responding' }
  }
  if ($reason) { $okStreak = 0; $last = $reason } else { $okStreak++ }
  Log ('probe ' + $probe + ': api ' + $apiNote + '; ' + $(if ($reason) { $reason } else { 'healthy' }) + ', streak ' + $okStreak)
  if ($okStreak -ge $okInARow) { Write-Result 'ok' '' 'probed'; Log 'helper finished (ok)'; exit 0 }
}
Roll-Back $last ''
`
}
