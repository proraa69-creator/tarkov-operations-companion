import { Worker } from 'node:worker_threads'
import type { RaidMode } from '../src/domain/types.js'
import { readLogSignalsFrom, type LogSignal } from '../src/import/eftLogTimeline.js'

/**
 * The game's logs parsed off the main process's thread (audit step 3): a player keeps hundreds of launches, a first read
 * parses tens or hundreds of megabytes, and the main process also runs the item lookup, the hotkeys and every IPC. Big
 * slices go to a worker thread (electron/logParseWorker.ts), which decodes and parses them; small ones — the few new
 * lines of a running game every 5 s — stay here, where a message would cost more than the parse. Without the worker (the
 * sources in the tests, or a worker that fails to start or dies) every slice is parsed here as before.
 */

export interface ParsedSlice { signals: LogSignal[]; gatewayMode?: RaidMode }

/** One slice of finished records, as the scanner reads them: decoded, without the line break before the next record. */
export function parseSignalSlice(bytes: Uint8Array, gatewayMode?: RaidMode): ParsedSlice {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8').replace(/\r?\n$/, '')
  return readLogSignalsFrom(text, gatewayMode)
}

/** What the parser needs of a worker (node:worker_threads Worker; a fake in the tests). */
export interface ParserWorker {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): unknown
  terminate(): Promise<number>
  unref?(): void
}

interface Job { resolve: (slice: ParsedSlice) => void; reject: (error: Error) => void }

/** Slices at least this big go to the worker. */
export const WORKER_MIN_BYTES = 256 * 1024
/** An unused worker is closed after this long (a first read is over; the next big one starts it again). */
export const WORKER_IDLE_MS = 60_000

export function createSliceParser(options: { spawn: (() => ParserWorker) | null; minBytes?: number; idleMs?: number }) {
  const minBytes = options.minBytes ?? WORKER_MIN_BYTES
  const idleMs = options.idleMs ?? WORKER_IDLE_MS
  let worker: ParserWorker | null = null
  let broken = !options.spawn
  let idle: ReturnType<typeof setTimeout> | null = null
  let nextId = 1
  const jobs = new Map<number, Job>()

  /** The worker failed or ended by itself: every later slice is parsed here; waiting ones are parsed here too. */
  function lost(dead: ParserWorker, error: Error) {
    if (worker !== dead) return
    worker = null
    broken = true
    for (const job of jobs.values()) job.reject(error)
    jobs.clear()
  }

  function current(): ParserWorker | null {
    if (broken) return null
    if (worker) return worker
    try {
      const created = options.spawn!()
      created.unref?.()
      created.on('message', (value) => {
        const message = value as { id?: number; error?: string } & Partial<ParsedSlice>
        const job = message.id === undefined ? undefined : jobs.get(message.id)
        if (!job) return
        jobs.delete(message.id!)
        if (message.error || !Array.isArray(message.signals)) job.reject(new Error(message.error ?? 'no signals'))
        else job.resolve({ signals: message.signals, gatewayMode: message.gatewayMode })
      })
      created.on('error', (error) => lost(created, error instanceof Error ? error : new Error(String(error))))
      created.on('exit', () => lost(created, new Error('the log parser stopped')))
      worker = created
      return created
    } catch {
      broken = true
      return null
    }
  }

  function closeLater() {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      idle = null
      if (jobs.size) return closeLater()
      const done = worker
      worker = null
      void done?.terminate().catch(() => 0)
    }, idleMs)
    ;(idle as { unref?: () => void }).unref?.()
  }

  return {
    /** The signals of `bytes[from, to)`: on the worker when the slice is big and the worker works, else here. */
    async parse(bytes: Buffer, from: number, to: number, gatewayMode?: RaidMode): Promise<ParsedSlice> {
      const target = to - from >= minBytes ? current() : null
      if (!target) return parseSignalSlice(bytes.subarray(from, to), gatewayMode)
      // A copy of its own, handed over (not copied again) to the worker.
      const copy = new Uint8Array(to - from)
      copy.set(bytes.subarray(from, to))
      const id = nextId++
      try {
        const slice = await new Promise<ParsedSlice>((resolve, reject) => {
          jobs.set(id, { resolve, reject })
          target.postMessage({ id, bytes: copy, gatewayMode }, [copy.buffer])
        })
        closeLater()
        return slice
      } catch {
        jobs.delete(id)
        return parseSignalSlice(bytes.subarray(from, to), gatewayMode)
      }
    },
    /** Whether slices go to a worker now (diagnostics and tests). */
    usesWorker: () => !broken,
    stop() {
      if (idle) clearTimeout(idle)
      idle = null
      const done = worker
      worker = null
      void done?.terminate().catch(() => 0)
    },
  }
}

/**
 * The app's parser: the worker only in the built app (dist-electron/electron/logParseWorker.js next to this file — inside
 * the app's archive, where Electron's worker threads load modules from as well), never for the sources the tests run.
 */
export const logSliceParser = createSliceParser({
  spawn: import.meta.url.endsWith('.js') ? () => new Worker(new URL('./logParseWorker.js', import.meta.url)) : null,
})
