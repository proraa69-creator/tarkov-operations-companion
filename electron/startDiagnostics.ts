/**
 * A start that cannot show its page says so (owner, 23.11.2026, a player's window dark at every start, with the graphics card
 * off too: «Делай выпуск приложения которое фиксит баг с черным экраном»). The page's own part is public/startup-intro.js:
 * when the app's code never starts it shows the reason and «Перезапустить». Here, the main process's part (electron/main.ts):
 * - the app's page could not be opened at all (did-fail-load before its first load): a message with the reason and
 *   «Попробовать снова» instead of a window that stays dark;
 * - the page's process ended after it had drawn (a crash leaves the window blank): the page loads again, a couple of times;
 * - what the page cannot know about itself (the version, Windows, the graphics card, the preload's error) goes to its
 *   failure screen, for the text the player sends to the support chat.
 */

/** Chromium's ERR_ABORTED: a load replaced by another one, not a failure. */
const LOAD_ABORTED = -3

/** Whether a did-fail-load is the app's own page failing to open: its main frame, before it ever loaded, not replaced. */
export function shouldReportLoadFailure(event: { code: number; isMainFrame: boolean; loaded: boolean }) {
  return event.isMainFrame && !event.loaded && event.code !== LOAD_ABORTED
}

/** How often the page loads again after its process ended, within RELOAD_WINDOW_MS; then it stays as it is. */
export const CRASH_RELOADS = 2
export const RELOAD_WINDOW_MS = 60_000

/** Whether the page loads again after its process ended: a real end, after the first picture, not too often. */
export function shouldReloadAfterCrash(reason: string, painted: boolean, reloads: readonly number[], now: number) {
  if (!painted || reason === 'clean-exit') return false
  return reloads.filter((at) => now - at < RELOAD_WINDOW_MS).length < CRASH_RELOADS
}

export interface StartFacts {
  version: string
  system: string
  /** app.getGPUFeatureStatus(): 2D canvas, compositing, WebGL. */
  gpu?: Record<string, string>
  softwareDrawing: boolean
  preloadError?: string
}

/** The lines of the failure screen the page cannot know itself. */
export function startNotes(facts: StartFacts): string[] {
  const gpu = facts.gpu ? ['gpu_compositing', '2d_canvas', 'webgl'].map((key) => `${key}: ${facts.gpu![key] ?? '?'}`).join(', ') : 'нет данных'
  return [
    `Версия ${facts.version} · ${facts.system}`,
    `Видеокарта: ${gpu}${facts.softwareDrawing ? ' · рисует без видеокарты' : ''}`,
    ...(facts.preloadError ? [`Ошибка preload: ${facts.preloadError.slice(0, 300)}`] : []),
  ]
}

/** The script that hands the notes to the page (public/startup-intro.js reads window.__raidosStartNotes). */
export function startNotesScript(notes: readonly string[]) {
  return `window.__raidosStartNotes = ${JSON.stringify(notes)}; undefined`
}
