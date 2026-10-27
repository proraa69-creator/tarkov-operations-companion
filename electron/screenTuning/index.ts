import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, nativeImage, powerMonitor } from 'electron'
import { cleanProfile, isNeutral, screenTables, type ScreenProfile } from '../../src/screen/screenCurve.js'
import { captureScreenRegion, foregroundDisplayMode, foregroundGame, visibleGameRect } from '../experimental/win32.js'
import { screenshotsFolder } from '../experimental/positionTracker.js'
import { displayAt, displayNames, gammaAvailable, readRamp, readVibrance, writeRamp, writeVibrance } from './display.js'
import { activePreset, allPresets, cleanSettings, DEFAULT_SETTINGS, deletePreset, renamePreset, restoreBuiltIns, revertBuiltIn, savePreset, writeStrongest, type ScreenTuningSettings } from './state.js'
import { defaultRun, optimize, optimizeStatus, revert, type OptimizeBackup } from './optimizer.js'

/**
 * «Настройка экрана» in the main process (owner, 27.10.2026). The chosen preset goes only into the game (owner: «рабочий
 * стол не должен применять этот пресет… только в игру Таркова»): it becomes the gamma ramp of the game's monitor (or the
 * one the player picked) only while the game's window is on it and not covered — the game in front, or uncovered on
 * another monitor beside this app. Covered, minimised or closed: that monitor is put back as it was. The page gets a
 * full-size, lossless picture of the game for its before / after preview, and the curve being edited is live in the game.
 * «Оптимизировать компьютер» lives here too (optimizer.ts).
 *
 * Every ramp the app wrote is put back when the game is not shown, the preset is turned off and the app closes — and,
 * after a crash, at the next start (screen-tuning-restore.json keeps the monitors' own ramps while ours is on).
 */

const settingsFile = () => join(app.getPath('userData'), 'screen-tuning.json')
const restoreFile = () => join(app.getPath('userData'), 'screen-tuning-restore.json')
const optimizeFile = () => join(app.getPath('userData'), 'pc-optimize-backup.json')

let settings: ScreenTuningSettings = DEFAULT_SETTINGS
let timer: NodeJS.Timeout | null = null
/** Each monitor's own ramp from before the app changed it. */
const originals = new Map<string, Uint16Array | null>()
let originalVibrance: number | null | undefined
/** What is on the screen now. */
let applied: { key: string; displays: string[]; strength: number; at: number } | null = null
/**
 * The curve being edited on the page, live in the game in place of the chosen preset (owner, 27.10.2026: «в режиме
 * реального времени в игре прям должно меняться»), until the page lets go or it runs out.
 */
let editing: { profile: ScreenProfile; until: number } | null = null
const EDITING_MS = 5 * 60_000
/**
 * The last picture of the game, at full size and lossless (owner, 27.10.2026: «не ухудшай качество скриншота»): the
 * pixels as copied; turned into a PNG only when the page asks, so the copy every half a minute in a raid costs no encoding.
 */
type Frame = { pixels: { data: Uint8Array; width: number; height: number }; at: number; source: 'game' }
let lastFrame: Frame | null = null
const FRAME_EVERY_MS = 30_000
const TICK_MS = 500
/** Games in exclusive full screen set their own ramp: ours is written again this often while the game is shown. */
const REWRITE_MS = 4000
/** The game's picture on screen now (physical pixels), or null: not running, minimised or covered. */
let gameRect: ReturnType<typeof visibleGameRect> = null
let gameInFront = false

function readJson(file: string): unknown {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null } catch { return null }
}

async function writeJson(file: string, value: unknown) {
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify(value), 'utf8')
  await rename(temporary, file)
}

function saveSettings() {
  void writeJson(settingsFile(), settings).catch(() => {})
}

function rememberOriginals() {
  const value = Object.fromEntries([...originals].filter(([, ramp]) => ramp).map(([name, ramp]) => [name, Array.from(ramp!)]))
  try {
    if (Object.keys(value).length || originalVibrance != null) writeFileSync(restoreFile(), JSON.stringify({ ramps: value, vibrance: originalVibrance ?? null }))
  } catch { /* the next start just finds nothing to restore */ }
}

/** A ramp left on the screen by a copy that did not close properly. */
function restoreLeftovers() {
  const saved = readJson(restoreFile()) as { ramps?: Record<string, number[]>; vibrance?: number | null } | null
  if (!saved) return
  for (const [name, values] of Object.entries(saved.ramps ?? {})) {
    if (Array.isArray(values) && values.length === 768) writeRamp(name, Uint16Array.from(values))
  }
  if (typeof saved.vibrance === 'number') writeVibrance(saved.vibrance)
  try { unlinkSync(restoreFile()) } catch { /* gone */ }
}

function restoreDisplay(name: string) {
  const original = originals.get(name)
  if (original) writeRamp(name, original)
  originals.delete(name)
}

function restoreAll() {
  for (const name of [...originals.keys()]) restoreDisplay(name)
  if (originalVibrance != null) writeVibrance(originalVibrance)
  originalVibrance = undefined
  applied = null
  try { unlinkSync(restoreFile()) } catch { /* nothing kept */ }
}

/** The monitor the game is shown on now ('' when the game is not shown). */
const gameDisplay = () => gameRect ? displayAt(gameRect.x + gameRect.width / 2, gameRect.y + gameRect.height / 2) : ''

/** The profile that should be on the screen now and on which monitor; null: every monitor as it is. */
function wanted(now: number): { profile: ScreenProfile; displays: string[] } | null {
  if (editing && editing.until < now) editing = null
  const profile = editing?.profile ?? (settings.enabled ? activePreset(settings) : null)
  if (!profile || (isNeutral(profile) && profile.vibrance === undefined)) return null
  // Only into the game: while it is shown, on its monitor (or the one picked), never the desktop.
  const display = gameDisplay()
  if (!display) return null
  return { profile, displays: [settings.display || display] }
}

function apply(profile: ScreenProfile, displays: string[], now: number) {
  const key = JSON.stringify([profile, displays])
  if (applied?.key === key && now - applied.at < REWRITE_MS) return
  for (const name of [...originals.keys()]) if (!displays.includes(name)) restoreDisplay(name)
  const tables = screenTables(profile)
  let strength = 1
  for (const name of displays) {
    if (!originals.has(name)) originals.set(name, readRamp(name))
    strength = Math.min(strength, writeStrongest(tables, originals.get(name) ?? null, (ramp) => writeRamp(name, ramp)))
  }
  const changed = !applied || applied.key !== key
  if (changed && profile.vibrance !== undefined) {
    if (originalVibrance === undefined) originalVibrance = readVibrance()
    if (originalVibrance !== null) writeVibrance(profile.vibrance)
  } else if (changed && originalVibrance != null) {
    writeVibrance(originalVibrance)
    originalVibrance = undefined
  }
  if (changed) rememberOriginals()
  applied = { key, displays, strength, at: now }
}

function tick() {
  const now = Date.now()
  gameInFront = foregroundGame() !== null
  gameRect = visibleGameRect()
  const target = wanted(now)
  if (target) apply(target.profile, target.displays, now)
  else if (applied || originals.size) restoreAll()
  if (gameRect && (!lastFrame || now - lastFrame.at > FRAME_EVERY_MS)) {
    const frame = captureGame()
    if (frame) lastFrame = frame
  }
}

/** The game's picture as it is drawn (a ramp changes what the monitor shows, not this copy), every pixel of it. */
function captureGame(): Frame | null {
  const rect = visibleGameRect()
  if (!rect) return null
  const shot = captureScreenRegion(rect.x, rect.y, rect.width, rect.height)
  if (!shot) return null
  for (let index = 3; index < shot.data.length; index += 4) shot.data[index] = 255
  return { pixels: shot, at: Date.now(), source: 'game' }
}

/** A frame for the page: PNG, full size, nothing lost. */
function frameView(frame: Frame) {
  const { data, width, height } = frame.pixels
  const image = nativeImage.createFromBitmap(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { width, height })
  return image.isEmpty() ? null : { dataUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`, at: frame.at, source: frame.source }
}

/** The newest screenshot the game saved (its own key, Print Screen by default): the file itself, not re-encoded. */
async function latestScreenshot() {
  const folder = screenshotsFolder()
  const names = await readdir(folder).catch(() => [] as string[])
  let newest: { file: string; at: number } | null = null
  for (const name of names) {
    if (!/\.(png|jpe?g)$/i.test(name)) continue
    const file = join(folder, name)
    const at = await stat(file).then((info) => info.mtimeMs).catch(() => 0)
    if (!newest || at > newest.at) newest = { file, at }
  }
  if (!newest) return null
  const bytes = await readFile(newest.file).catch(() => null)
  if (!bytes?.length) return null
  const type = /\.png$/i.test(newest.file) ? 'image/png' : 'image/jpeg'
  return { dataUrl: `data:${type};base64,${bytes.toString('base64')}`, at: newest.at, source: 'screenshot' as const }
}

function status() {
  return {
    available: process.platform === 'win32' && gammaAvailable(),
    gameShown: Boolean(gameRect),
    gameDisplay: gameDisplay(),
    displays: displayNames(),
    exclusive: gameInFront && foregroundDisplayMode() === 'exclusive',
    applied: applied ? { displays: applied.displays.length, strength: applied.strength } : null,
    editing: Boolean(editing),
    vibrance: readVibrance(),
  }
}

function view() {
  return { settings, presets: allPresets(settings), status: status(), frame: lastFrame ? { at: lastFrame.at, source: lastFrame.source } : null }
}

let optimizeBackup: OptimizeBackup | null = null

function change(next: ScreenTuningSettings) {
  settings = cleanSettings(next)
  saveSettings()
  tick()
  return view()
}

export function startScreenTuning() {
  if (timer) return
  settings = cleanSettings(readJson(settingsFile()))
  optimizeBackup = readJson(optimizeFile()) as OptimizeBackup | null
  if (process.platform === 'win32') {
    restoreLeftovers()
    timer = setInterval(tick, TICK_MS)
  }

  ipcMain.handle('screen:state', () => view())
  ipcMain.handle('screen:update', (_event, patch: unknown) => {
    const raw = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
    return change({
      ...settings,
      ...('activeId' in raw ? { activeId: String(raw.activeId ?? '') } : {}),
      ...('enabled' in raw ? { enabled: raw.enabled === true } : {}),
      ...('display' in raw ? { display: String(raw.display ?? '') } : {}),
    })
  })
  ipcMain.handle('screen:save-preset', (_event, preset: unknown) => {
    const result = savePreset(settings, preset, () => `own-${randomUUID()}`)
    editing = null
    return { ...change({ ...result.settings, activeId: result.preset.id }), savedId: result.preset.id }
  })
  ipcMain.handle('screen:rename-preset', (_event, id: unknown, name: unknown) => change(renamePreset(settings, String(id ?? ''), name)))
  ipcMain.handle('screen:delete-preset', (_event, id: unknown) => change(deletePreset(settings, String(id ?? ''))))
  ipcMain.handle('screen:restore-presets', () => change(restoreBuiltIns(settings)))
  ipcMain.handle('screen:revert-preset', (_event, id: unknown) => change(revertBuiltIn(settings, String(id ?? ''))))
  ipcMain.handle('screen:edit', (_event, profile: unknown) => {
    const clean = profile === null ? null : cleanProfile(profile)
    editing = clean ? { profile: clean, until: Date.now() + EDITING_MS } : null
    tick()
    return status()
  })
  ipcMain.handle('screen:frame', async (_event, kind: unknown) => {
    if (kind === 'screenshot') return latestScreenshot()
    if (kind === 'game') {
      const frame = captureGame()
      if (frame) lastFrame = frame
      return frame ? frameView(frame) : null
    }
    return lastFrame ? frameView(lastFrame) : null
  })
  ipcMain.handle('screen:optimize-status', () => optimizeStatus(defaultRun, powerMonitor.isOnBatteryPower(), optimizeBackup))
  ipcMain.handle('screen:optimize-apply', async () => {
    const result = await optimize(defaultRun, powerMonitor.isOnBatteryPower(), optimizeBackup)
    optimizeBackup = result.backup
    await writeJson(optimizeFile(), optimizeBackup).catch(() => {})
    return { done: result.done, skipped: result.skipped, status: await optimizeStatus(defaultRun, powerMonitor.isOnBatteryPower(), optimizeBackup) }
  })
  ipcMain.handle('screen:optimize-revert', async () => {
    const done = await revert(defaultRun, optimizeBackup)
    optimizeBackup = null
    try { unlinkSync(optimizeFile()) } catch { /* none */ }
    return { done, status: await optimizeStatus(defaultRun, powerMonitor.isOnBatteryPower(), optimizeBackup) }
  })
}

/** The app closes: the screen as it was. */
export function stopScreenTuning() {
  if (timer) clearInterval(timer)
  timer = null
  editing = null
  restoreAll()
}
