import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir, stat, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, nativeImage, powerMonitor } from 'electron'
import { cleanProfile, isNeutral, screenTables, type ScreenProfile } from '../../src/screen/screenCurve.js'
import { captureScreenRegion, foregroundDisplayMode, foregroundGame, visibleGameRect } from '../experimental/win32.js'
import { screenshotsFolder } from '../experimental/positionTracker.js'
import { displayAt, displayNames, gammaAvailable, readRamp, readVibrance, writeRamp, writeVibrance } from './display.js'
import { activePreset, allPresets, cleanSettings, DEFAULT_SETTINGS, deletePreset, savePreset, writeStrongest, type ScreenTuningSettings } from './state.js'
import { defaultRun, optimize, optimizeStatus, revert, type OptimizeBackup } from './optimizer.js'

/**
 * «Настройка экрана» in the main process (owner, 27.10.2026): the chosen preset becomes the gamma ramp of the monitor the
 * game is on while the game's window is in front (or all the time), the player's presets are kept, and the page gets
 * a picture of the game for its before / after preview. «Оптимизировать компьютер» lives here too (optimizer.ts).
 *
 * Every ramp the app wrote is put back when the preset is turned off, the game leaves the front, the app closes — and,
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
/** The page's «Попробовать на экране»: shown on every monitor until the page lets go or it runs out. */
let trial: { profile: ScreenProfile; until: number } | null = null
const TRIAL_MS = 5 * 60_000
let lastFrame: { dataUrl: string; at: number; source: 'game' | 'screenshot' } | null = null
const FRAME_EVERY_MS = 30_000
const TICK_MS = 700
/** Games in exclusive full screen set their own ramp: ours is written again this often while the game is in front. */
const REWRITE_MS = 4000
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

/** The profile that should be on the screen now and on which monitors; null: the screen as it is. */
function wanted(now: number): { profile: ScreenProfile; displays: string[] } | null {
  if (trial && trial.until < now) trial = null
  if (trial) return isNeutral(trial.profile) && trial.profile.vibrance === undefined ? null : { profile: trial.profile, displays: displayNames() }
  if (!settings.enabled) return null
  const profile = activePreset(settings)
  if (isNeutral(profile) && profile.vibrance === undefined) return null
  if (settings.when === 'always') return { profile, displays: displayNames() }
  if (!gameInFront) return null
  const rect = visibleGameRect()
  const display = rect ? displayAt(rect.x + rect.width / 2, rect.y + rect.height / 2) : ''
  return { profile, displays: display ? [display] : displayNames() }
}

function apply(profile: ScreenProfile, displays: string[], now: number) {
  const key = JSON.stringify([profile, displays])
  if (applied?.key === key && now - applied.at < REWRITE_MS) return
  if (applied?.key === key && !gameInFront) return
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
  const target = wanted(now)
  if (target) apply(target.profile, target.displays, now)
  else if (applied || originals.size) restoreAll()
  if (gameInFront && (!lastFrame || lastFrame.source !== 'game' || now - lastFrame.at > FRAME_EVERY_MS)) {
    const frame = captureGame()
    if (frame) lastFrame = frame
  }
}

/** The game's picture as it is drawn (a ramp changes what the monitor shows, not this copy): JPEG, at most 1600 wide. */
function captureGame(): typeof lastFrame {
  const rect = visibleGameRect()
  if (!rect) return null
  const shot = captureScreenRegion(rect.x, rect.y, rect.width, rect.height)
  if (!shot) return null
  for (let index = 3; index < shot.data.length; index += 4) shot.data[index] = 255
  return encode(nativeImage.createFromBitmap(Buffer.from(shot.data.buffer, shot.data.byteOffset, shot.data.byteLength), { width: shot.width, height: shot.height }), 'game')
}

function encode(image: Electron.NativeImage, source: 'game' | 'screenshot') {
  if (image.isEmpty()) return null
  const { width } = image.getSize()
  const fitted = width > 1600 ? image.resize({ width: 1600, quality: 'good' }) : image
  return { dataUrl: `data:image/jpeg;base64,${fitted.toJPEG(84).toString('base64')}`, at: Date.now(), source }
}

/** The newest screenshot the game saved (its own key, Print Screen by default). */
async function latestScreenshot(): Promise<typeof lastFrame> {
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
  const frame = encode(nativeImage.createFromPath(newest.file), 'screenshot')
  return frame ? { ...frame, at: newest.at } : null
}

function status() {
  return {
    available: process.platform === 'win32' && gammaAvailable(),
    gameInFront,
    exclusive: gameInFront && foregroundDisplayMode() === 'exclusive',
    applied: applied ? { displays: applied.displays.length, strength: applied.strength } : null,
    trial: Boolean(trial),
    vibrance: readVibrance(),
  }
}

function view() {
  return { settings, presets: allPresets(settings), status: status(), frame: lastFrame ? { at: lastFrame.at, source: lastFrame.source } : null }
}

let optimizeBackup: OptimizeBackup | null = null

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
    settings = cleanSettings({ ...settings, ...('activeId' in raw ? { activeId: raw.activeId } : {}), ...('enabled' in raw ? { enabled: raw.enabled === true } : {}), ...('when' in raw ? { when: raw.when } : {}) })
    saveSettings()
    tick()
    return view()
  })
  ipcMain.handle('screen:save-preset', (_event, preset: unknown) => {
    const result = savePreset(settings, preset, () => `own-${randomUUID()}`)
    settings = { ...result.settings, activeId: result.preset.id }
    saveSettings()
    tick()
    return { ...view(), savedId: result.preset.id }
  })
  ipcMain.handle('screen:delete-preset', (_event, id: unknown) => {
    settings = deletePreset(settings, String(id ?? ''))
    saveSettings()
    tick()
    return view()
  })
  ipcMain.handle('screen:try', (_event, profile: unknown) => {
    const clean = profile === null ? null : cleanProfile(profile)
    trial = clean ? { profile: clean, until: Date.now() + TRIAL_MS } : null
    tick()
    return status()
  })
  ipcMain.handle('screen:frame', async (_event, kind: unknown) => {
    if (kind === 'screenshot') return latestScreenshot()
    if (kind === 'game') {
      const frame = captureGame()
      if (frame) lastFrame = frame
      return frame
    }
    return lastFrame
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
  trial = null
  restoreAll()
}
