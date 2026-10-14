/**
 * One OCR job at a time across the app's Tesseract engines — the quest scanner's, the item card's and the Collector
 * scan's. Each reading takes a processor core, and two or three at once (the scanner during an item lookup or a Kappa
 * scan) made the game stutter (electron/collectorScan.ts: «two made the game stutter»). A job the player waits for
 * (`interactive`: the item card, the Collector scan) goes before the background ones waiting (the quest scanner); a
 * running job is never cut short. A Tesseract worker also takes one job at a time, so this keeps each engine in order too.
 */
export type OcrPriority = 'interactive' | 'background'

interface Waiting { priority: OcrPriority; start: () => void }

const waiting: Waiting[] = []
let running = false

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
  if (running || !waiting.length) return
  const interactive = waiting.findIndex((entry) => entry.priority === 'interactive')
  const index = interactive >= 0 ? interactive : backgroundScansHeld() ? -1 : 0
  if (index < 0) { pumpLater(); return }
  const [next] = waiting.splice(index, 1)
  running = true
  next!.start()
}

export function runOcrJob<T>(job: () => Promise<T>, priority: OcrPriority = 'background'): Promise<T> {
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
        void result.then(resolve, reject).finally(() => {
          running = false
          pump()
        })
      },
    })
    pump()
  })
}
