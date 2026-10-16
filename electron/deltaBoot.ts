import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { deltaSignatureValid, parseDeltaInfo, STAGED_INFO } from './deltaInfo.js'

/**
 * Where the app keeps builds installed by a partial update (electron/appDelta.ts) and which one starts (electron/boot.ts).
 * No Electron imports: boot.ts runs it before anything else, the tests run it with a temporary folder.
 *
 *   %APPDATA%\Raid OS Updates\state.json             the owner's copy: { current, pending, confirmed, bad }
 *   %APPDATA%\Raid OS Updates\<build>\app.asar        (+ app.asar.unpacked)
 *   %APPDATA%\Raid OS Updates\client\…                a player's copy, the same layout (+ delta-info.json, signed)
 *
 * A staged build starts only when it is newer than the one inside the exe. Its first start is «pending» until the window
 * has loaded its page (confirmBoot); a start that never got there (crash, error) marks the build bad and the next start
 * runs the exe's own build again. A copy that is still running (a second launch, the elevated relaunch) is not a failure.
 * A player's copy also starts only a build whose signed manifest verifies (stagedBuildVerified).
 */
export const DELTA_FOLDER = 'Raid OS Updates'
export const ENTRY = ['dist-electron', 'electron', 'main.js'] as const

export interface DeltaBuild { build: number; version: string; commit: string; dir: string }
export interface DeltaState { current?: DeltaBuild; pending?: { build: number; pid: number }; confirmed?: number[]; bad?: number[] }

/** The few file functions this needs (`original-fs` in Electron: an .asar path is a plain file here). */
export interface BootFs {
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string): void
  renameSync(from: string, to: string): void
  mkdirSync(path: string, options: { recursive: true }): unknown
  statSync(path: string): { size: number; isFile(): boolean }
  openSync(path: string, flags: string): number
  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number): number
  closeSync(fd: number): void
}

export type DeltaEdition = 'owner' | 'client'

/** The owner's copy keeps its folder as it always was; a player's copy has its own (both can be on one computer). */
export const deltaRoot = (appData: string, edition: DeltaEdition = 'owner') => edition === 'client' ? join(appData, DELTA_FOLDER, 'client') : join(appData, DELTA_FOLDER)

/**
 * A player's staged build is the release exactly as signed: its delta-info.json verifies with the update key and names
 * this build, the archive has the signed size and header (which holds every file's SHA-256). The whole archive was
 * checked against the signed SHA-256 when it was built (stageDelta); each start reads only the header, not 150 MB again.
 */
export function stagedBuildVerified(fs: BootFs, dir: string, build: number, publicKey: string) {
  try {
    const info = parseDeltaInfo(JSON.parse(fs.readFileSync(join(dir, STAGED_INFO), 'utf8')))
    if (!info || info.build !== build || !info.asar.headerSha256 || !deltaSignatureValid(info, publicKey)) return false
    const archive = join(dir, 'app.asar')
    if (fs.statSync(archive).size !== info.asar.size) return false
    const header = Buffer.alloc(info.asar.dataStart)
    const fd = fs.openSync(archive, 'r')
    try {
      for (let done = 0; done < header.length;) {
        const read = fs.readSync(fd, header, done, header.length - done, done)
        if (!read) return false
        done += read
      }
    } finally {
      fs.closeSync(fd)
    }
    return createHash('sha256').update(header).digest('hex') === info.asar.headerSha256
  } catch {
    return false
  }
}
const DIR = /^[0-9]{13}$/
const isBuild = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const builds = (value: unknown) => (Array.isArray(value) ? value.filter(isBuild).slice(-20) : [])

export function readDeltaState(fs: BootFs, root: string): DeltaState {
  try {
    const raw = JSON.parse(fs.readFileSync(join(root, 'state.json'), 'utf8')) as Record<string, unknown>
    const state: DeltaState = { confirmed: builds(raw.confirmed), bad: builds(raw.bad) }
    const current = raw.current as Partial<DeltaBuild> | undefined
    if (current && isBuild(current.build) && typeof current.dir === 'string' && DIR.test(current.dir) && current.dir === String(current.build)) {
      state.current = { build: current.build, version: String(current.version ?? ''), commit: String(current.commit ?? ''), dir: current.dir }
    }
    const pending = raw.pending as { build?: unknown; pid?: unknown } | undefined
    if (pending && isBuild(pending.build) && isBuild(pending.pid)) state.pending = { build: pending.build, pid: pending.pid }
    return state
  } catch {
    return {}
  }
}

export function writeDeltaState(fs: BootFs, root: string, state: DeltaState) {
  fs.mkdirSync(root, { recursive: true })
  const file = join(root, 'state.json')
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state))
  fs.renameSync(`${file}.tmp`, file)
}

export interface BootChoice { build: number; main: string }

/**
 * The staged build to start instead of the exe's own one, or null. `packaged`: the exe's own build-info.json. A player's
 * copy (client edition) starts a staged build only when `verify` accepts it (stagedBuildVerified with the update key).
 * Records this start as pending (or a dead pending one as bad).
 */
export function chooseBoot(options: { fs: BootFs; root: string; packaged: { edition?: unknown; build?: unknown }; pid: number; alive: (pid: number) => boolean; verify?: (dir: string, build: number) => boolean }): BootChoice | null {
  const { fs, root, packaged, pid, alive, verify } = options
  if ((packaged.edition !== 'owner' && packaged.edition !== 'client') || !isBuild(packaged.build)) return null
  const state = readDeltaState(fs, root)
  const current = state.current
  if (!current || current.build <= packaged.build || state.bad?.includes(current.build)) return null
  if (packaged.edition === 'client' && !verify?.(join(root, current.dir), current.build)) return null
  const confirmed = state.confirmed?.includes(current.build) ?? false
  if (!confirmed && state.pending?.build === current.build && state.pending.pid !== pid && !alive(state.pending.pid)) {
    // The last start of this build never showed its window: back to the exe's own build.
    writeDeltaState(fs, root, { ...state, pending: undefined, bad: [...(state.bad ?? []), current.build] })
    return null
  }
  const dir = join(root, current.dir)
  try {
    if (!fs.statSync(join(dir, 'app.asar')).isFile()) return null
  } catch {
    return null
  }
  if (!confirmed && !(state.pending?.build === current.build && alive(state.pending.pid))) writeDeltaState(fs, root, { ...state, pending: { build: current.build, pid } })
  return { build: current.build, main: join(dir, 'app.asar', ...ENTRY) }
}

/** The window of this start loaded its page: the staged build works. */
export function confirmBoot(fs: BootFs, root: string, pid: number) {
  const state = readDeltaState(fs, root)
  if (!state.pending || state.pending.pid !== pid) return false
  const build = state.pending.build
  writeDeltaState(fs, root, { ...state, pending: undefined, confirmed: [...new Set([...(state.confirmed ?? []), build])] })
  return true
}

/** A staged build failed to load at all: never start it again by itself. */
export function markBad(fs: BootFs, root: string, build: number) {
  const state = readDeltaState(fs, root)
  writeDeltaState(fs, root, { ...state, pending: undefined, bad: [...new Set([...(state.bad ?? []), build])] })
}
