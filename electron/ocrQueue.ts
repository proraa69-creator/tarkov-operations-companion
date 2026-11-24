/**
 * OCR across the app's Tesseract engines — the quest scanner's, the item card's and the Collector scan's. Each reading
 * takes a processor core, and two or three at once (the scanner during an item lookup or a Kappa scan) made the game
 * stutter (electron/collectorScan.ts: «two made the game stutter»). So the background readings (the quest scanner) go
 * one at a time and never start while a reading the player waits for (`interactive`: the item card, the Collector scan)
 * runs or waits; the interactive ones go one at a time too.
 *
 * A reading the player waits for no longer waits for a background one already running, though: a running reading is
 * never cut short, and the scanner's whole-screen pass takes ~6 s (measured 18.11.2026: 1421×1080 with word boxes,
 * 6065 ms; one tooltip line 25–135 ms). An item key pressed during such a pass waited for its end — the 5–6 s lookups
 * (owner, 18.11.2026: «очень долго ищет некоторые предметы, может грузиться 5-6 секунд»). It starts at once beside it
 * (its own engine, its own thread): two readings at once only for the lookup's few short ones.
 */
export type OcrPriority = 'interactive' | 'background'

interface Waiting { priority: OcrPriority; start: () => void }

const waiting: Waiting[] = []
/** The reading running in each lane: one background and one interactive at most. */
const running: Record<OcrPriority, boolean> = { interactive: false, background: false }

/** While an item lookup runs, and a moment after (the player may press again). */
export const AFTER_HOLD_MS = 1500
let holds = 0
let heldUntil = 0
let pumpTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Background scans hold off: no new screen copy by the quest scanner (it asks again soon), and a background reading
 * already queued waits — so a lookup's readings never queue behind a whole-screen pass of several seconds.
 */
export function backgroundScansHeld(now = Date.now()) {
  return holds > 0 || now < heldUntil
}

/** An item lookup starts: background scans hold off until the returned release (and AFTER_HOLD_MS more). */
export function holdBackgroundScans(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    holdBackgroundScansFor(AFTER_HOLD_MS)
  }
}

/** Background scans hold off this long from now (each pass of a Kappa scan, which comes every second or so, renews it). */
export function holdBackgroundScansFor(ms: number) {
  heldUntil = Math.max(heldUntil, Date.now() + ms)
  pumpLater()
}

function pumpLater() {
  if (pumpTimer || !waiting.length) return
  const wait = holds > 0 ? 250 : Math.max(20, heldUntil - Date.now())
  pumpTimer = setTimeout(() => { pumpTimer = null; pump() }, wait)
  pumpTimer.unref?.()
}

function pump() {
  if (!waiting.length) return
  const interactive = waiting.findIndex((entry) => entry.priority === 'interactive')
  if (interactive >= 0) {
    // The player waits: beside a background reading already running, never behind it.
    if (!running.interactive) start(interactive)
    return
  }
  if (running.interactive || running.background) return
  if (backgroundScansHeld()) { pumpLater(); return }
  start(0)
}

function start(index: number) {
  const [next] = waiting.splice(index, 1)
  running[next!.priority] = true
  next!.start()
}

/** A reading that never ends (the engine hung) gives the queue up after this long, so no later reading waits on it forever. */
export const OCR_JOB_TIMEOUT_MS = 60_000

/** The reading took longer than its limit: the engine that ran it is to be started again (see screenOcr.ts). */
export class OcrTimeoutError extends Error {
  constructor(ms: number) {
    super(`OCR reading took longer than ${ms} ms`)
    this.name = 'OcrTimeoutError'
  }
}

export const isOcrTimeout = (error: unknown): error is OcrTimeoutError => error instanceof OcrTimeoutError

/**
 * `timeoutMs`: a reading still running after this long is given up — its promise rejects with OcrTimeoutError and the
 * next reading starts. Without it one hung engine stopped every later reading (the item key «broke for good», reports
 * of 10.11.2026). Whatever the hung reading gives later is ignored.
 */
export function runOcrJob<T>(job: () => Promise<T>, priority: OcrPriority = 'background', timeoutMs = OCR_JOB_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({
      priority,
      start: () => {
        let result: Promise<T>
        try {
          result = job()
        } catch (error) {
          result = Promise.reject(error)
        }
        let settled = false
        const finish = () => {
          if (settled) return false
          settled = true
          clearTimeout(timer)
          running[priority] = false
          pump()
          return true
        }
        const timer = setTimeout(() => { if (finish()) reject(new OcrTimeoutError(timeoutMs)) }, timeoutMs)
        timer.unref?.()
        void result.then(
          (value) => { if (finish()) resolve(value) },
          (error: unknown) => { if (finish()) reject(error) },
        )
      },
    })
    pump()
  })
}
