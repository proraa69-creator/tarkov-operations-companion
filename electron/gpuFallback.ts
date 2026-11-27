/**
 * Drawing without the graphics card when it draws nothing (owner, 23.11.2026, after a player's support chat: «скачал ваше
 * приложение, но когда я его запускаю, то появляется черный экран»; «по перезапуску приложения из за черного экрана делай»).
 *
 * The window is shown with its first picture, or after 5 s whatever it has (main.ts): a graphics driver Chromium cannot use
 * leaves it dark. When at a start the graphics process dies, or the page dies, or nothing is drawn for FIRST_PAINT_MS, the app
 * notes it (gpu-fallback.json in its data folder) and starts again once, drawing in software
 * (app.disableHardwareAcceleration(), which must be called before the app is ready). It stays so: a card that failed once is not
 * tried at every start. A start with `--disable-gpu` draws in software too (Chromium's own switch).
 *
 * The start without Chromium's sandbox (the step after software drawing) is for a while only (security review, 27.11.2026): after
 * SANDBOX_BACK_AFTER starts that showed their window (noteShownStart) the sandbox is tried again — software drawing stays. Should
 * the window be dark again, the next start goes without the sandbox at once (nextStartStep), for as many starts again. The same
 * for a shortcut's --no-sandbox that reached the copy with administrator rights (experimental/elevation.ts): after as many shown
 * starts it is not handed on any more.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const GPU_FALLBACK_FILE = 'gpu-fallback.json'
/** How long a start may take to draw its page before the graphics card is blamed (a slow PC's first start included). */
export const FIRST_PAINT_MS = 25_000
/** Starts without the sandbox that showed their window, after which the sandbox is tried again. */
export const SANDBOX_BACK_AFTER = 3

export interface GpuFallbackState {
  /** Drawing in software since a start that drew nothing. */
  softwareDrawing: boolean
  /**
   * Started without Chromium's sandbox since a start that drew nothing in software either (owner, 23.11.2026: 0.6.0.335 still dark
   * for a player who had tried --disable-gpu): security software that blocks the sandboxed page process leaves the window dark.
   * For SANDBOX_BACK_AFTER shown starts (`shownStarts` counts them).
   */
  noSandbox?: boolean
  /** Starts without the sandbox (noSandbox) that showed their window. */
  shownStarts?: number
  /** Shown starts of a copy with administrator rights that got the shortcut's --no-sandbox. */
  argumentShownStarts?: number
  /** The shortcut's --no-sandbox had its SANDBOX_BACK_AFTER starts: no longer handed to the copy with administrator rights. */
  argumentNoSandboxSpent?: boolean
  reason?: string
  at?: string
}

const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, SANDBOX_BACK_AFTER) : 0)

export function readGpuFallback(dataFolder: string): GpuFallbackState {
  const file = join(dataFolder, GPU_FALLBACK_FILE)
  if (!existsSync(file)) return { softwareDrawing: false }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<GpuFallbackState>
    const noSandbox = parsed.noSandbox === true
    return {
      softwareDrawing: parsed.softwareDrawing === true,
      ...(noSandbox ? { noSandbox: true } : {}),
      ...(noSandbox && count(parsed.shownStarts) ? { shownStarts: count(parsed.shownStarts) } : {}),
      ...(count(parsed.argumentShownStarts) ? { argumentShownStarts: count(parsed.argumentShownStarts) } : {}),
      ...(parsed.argumentNoSandboxSpent === true ? { argumentNoSandboxSpent: true } : {}),
      ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}),
      ...(typeof parsed.at === 'string' ? { at: parsed.at } : {}),
    }
  } catch {
    return { softwareDrawing: false }
  }
}

/** A start that drew nothing: software drawing, and without the sandbox for SANDBOX_BACK_AFTER shown starts from now. */
export function writeGpuFallback(dataFolder: string, reason: string, now = new Date(), noSandbox = false) {
  const previous = readGpuFallback(dataFolder)
  const state: GpuFallbackState = {
    softwareDrawing: true,
    ...(noSandbox ? { noSandbox: true } : {}),
    ...(previous.argumentShownStarts ? { argumentShownStarts: previous.argumentShownStarts } : {}),
    ...(previous.argumentNoSandboxSpent ? { argumentNoSandboxSpent: true } : {}),
    reason,
    at: now.toISOString(),
  }
  writeFileSync(join(dataFolder, GPU_FALLBACK_FILE), JSON.stringify(state))
  return state
}

/**
 * A start that showed its window (main.ts: its first picture, its page loaded, open DARK_WINDOW_MS without a restart or the
 * player calling it black). `noSandbox`: it ran without the sandbox because of the note; `noSandboxByArgument`: a copy with
 * administrator rights that got the shortcut's --no-sandbox. The SANDBOX_BACK_AFTER-th such start lets the sandbox back: the note
 * drops `noSandbox` (software drawing stays), and the shortcut's switch is not handed on again. What it changed, for the start
 * log; nothing is written for a start that ran with the sandbox.
 */
export function noteShownStart(dataFolder: string, how: { noSandbox: boolean; noSandboxByArgument: boolean }, now = new Date()) {
  if (!how.noSandbox && !how.noSandboxByArgument) return null
  const state = readGpuFallback(dataFolder)
  const next: GpuFallbackState = { ...state }
  let counted = false
  let sandboxBack = false
  let argumentSpent = false
  if (how.noSandbox && state.noSandbox) {
    const shown = (state.shownStarts ?? 0) + 1
    delete next.shownStarts
    if (shown >= SANDBOX_BACK_AFTER) { delete next.noSandbox; sandboxBack = true } else next.shownStarts = shown
    counted = true
  }
  if (how.noSandboxByArgument && !state.argumentNoSandboxSpent) {
    const shown = (state.argumentShownStarts ?? 0) + 1
    delete next.argumentShownStarts
    if (shown >= SANDBOX_BACK_AFTER) { next.argumentNoSandboxSpent = true; argumentSpent = true } else next.argumentShownStarts = shown
    counted = true
  }
  if (!counted) return null
  if (sandboxBack || argumentSpent) next.at = now.toISOString()
  writeFileSync(join(dataFolder, GPU_FALLBACK_FILE), JSON.stringify(next))
  return { state: next, sandboxBack, argumentSpent }
}

/**
 * Whether the shortcut's --no-sandbox may still go to the copy with administrator rights (experimental/elevation.ts): until it
 * had SANDBOX_BACK_AFTER shown starts there.
 */
export function shortcutNoSandboxAllowed(dataFolder: string) {
  return readGpuFallback(dataFolder).argumentNoSandboxSpent !== true
}

export type DrawingTrouble =
  /** The graphics process ended (details.type 'GPU' of app 'child-process-gone'), with its reason. */
  | { kind: 'gpu-gone'; reason: string }
  /** The page's process ended before it drew anything. */
  | { kind: 'page-gone'; reason: string }
  /** Nothing drawn FIRST_PAINT_MS after the window was made. */
  | { kind: 'no-picture' }
  /**
   * The player says the window is black (owner, 23.11.2026: a player's window stayed black with 0.6.0.336 and no message):
   * Chromium had drawn its first picture, but nothing reached the screen — a driver or an overlay. Asked by a window of
   * Windows itself, which shows whatever happens to the page.
   */
  | { kind: 'seen-black' }

/** Reasons a process ends that are no failure of the card. */
const CLEAN_ENDS = new Set(['clean-exit'])


/** What a start that drew nothing does next: draw in software, then start without the sandbox, then say why and stop. */
export type StartStep = 'software' | 'no-sandbox' | 'report'

/**
 * The next step for a trouble before the page's first picture (after it nothing: a page that has drawn works): software drawing
 * first (unless --disable-gpu already does it), then no sandbox, then the report the player can copy for support.
 */
export function nextStartStep(trouble: DrawingTrouble, state: { softwareDrawing: boolean; noSandbox: boolean; painted: boolean; disabledByArgument: boolean }): StartStep | undefined {
  // The player's word counts after the first picture too: that picture is exactly what did not reach the screen.
  if (state.painted && trouble.kind !== 'seen-black') return undefined
  if ((trouble.kind === 'gpu-gone' || trouble.kind === 'page-gone') && CLEAN_ENDS.has(trouble.reason)) return undefined
  if (!state.softwareDrawing && !state.disabledByArgument) return 'software'
  if (!state.noSandbox) return 'no-sandbox'
  return 'report'
}

/**
 * A window that looks black while Chromium has drawn into it gives no sign of its own, so the player is asked by a window of
 * Windows (owner, 23.11.2026: «ему не надо будет вот этого все вводить… Он просто скачает новую версию и включит»):
 * - the app started again while its window is open, within DARK_WINDOW_MS of it appearing;
 * - the window closed within DARK_WINDOW_MS: the next start asks, once, over its window.
 * Both only on a PC where the app never had a working subscription (a new player who never got in): a player who uses the
 * app is never asked (his support advice is --disable-gpu in the shortcut, which now reaches the window, elevation.ts).
 * «Да» takes the next step of nextStartStep; «Нет» after a close is remembered and never asked there again.
 */
export const DARK_WINDOW_MS = 3 * 60_000
export const DARK_WINDOW_FILE = 'dark-window-check.json'
/** `ask`: the window closed soon after it appeared, ask at the next start; `never`: the player said it was fine. */
export type DarkWindowCheck = 'ask' | 'never'

/** The window appeared (`shownAt`, ms) no longer than DARK_WINDOW_MS ago. */
export function soonAfterShown(shownAt: number | null, now: number) {
  return shownAt !== null && now >= shownAt && now - shownAt <= DARK_WINDOW_MS
}

export function readDarkWindowCheck(dataFolder: string): DarkWindowCheck | undefined {
  try {
    const state = (JSON.parse(readFileSync(join(dataFolder, DARK_WINDOW_FILE), 'utf8')) as { state?: unknown }).state
    return state === 'ask' || state === 'never' ? state : undefined
  } catch {
    return undefined
  }
}

/** undefined removes the note (it was asked). */
export function writeDarkWindowCheck(dataFolder: string, state: DarkWindowCheck | undefined, now = new Date()) {
  const file = join(dataFolder, DARK_WINDOW_FILE)
  if (state) writeFileSync(file, JSON.stringify({ state, at: now.toISOString() }))
  else rmSync(file, { force: true })
}

/**
 * Whether closing the window now leaves a question for the next start: soon after it appeared, on a PC where the app never
 * worked (`everWorked`: a subscription was seen here), unless the player already said it was fine or a fallback restarts it.
 */
export function asksAtNextStart(input: { shownAt: number | null; now: number; everWorked: boolean; check: DarkWindowCheck | undefined; restarting: boolean }) {
  return !input.restarting && !input.everWorked && input.check !== 'never' && soonAfterShown(input.shownAt, input.now)
}

const GPU_VENDORS: Record<number, string> = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x1414: 'Microsoft', 0x5143: 'Qualcomm', 0x15ad: 'VMware', 0x80ee: 'VirtualBox', 0x1ab8: 'Parallels' }
const hex = (value: number) => value.toString(16).padStart(4, '0')

/**
 * The graphics cards for the start log, from app.getGPUInfo('basic'): vendor, ids, driver; `*` marks the one in use.
 * Microsoft 1414 is Windows' basic display driver: no real driver installed. Nothing personal.
 */
export function describeGpus(info: unknown) {
  const devices = info && typeof info === 'object' && Array.isArray((info as { gpuDevice?: unknown }).gpuDevice) ? (info as { gpuDevice: unknown[] }).gpuDevice : []
  return devices.slice(0, 4).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const device = entry as { vendorId?: unknown; deviceId?: unknown; active?: unknown; driverVersion?: unknown }
    const vendor = typeof device.vendorId === 'number' ? device.vendorId : 0
    const id = typeof device.deviceId === 'number' ? device.deviceId : 0
    if (!vendor && !id) return []
    const driver = typeof device.driverVersion === 'string' && /^[\w.-]{1,40}$/.test(device.driverVersion) ? ` driver ${device.driverVersion}` : ''
    return [`${device.active === true ? '*' : ''}${GPU_VENDORS[vendor] ?? 'vendor'} ${hex(vendor)}:${hex(id)}${driver}`]
  }).join(', ')
}
