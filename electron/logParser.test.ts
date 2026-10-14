import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLogSignalsFrom } from '../src/import/eftLogTimeline'
import { createSliceParser, parseSignalSlice, type ParserWorker } from './logParser'

const V = '1.1.5.1.47510'
const text = [
  `2026-09-26 22:05:12.029|${V}|Info|application|Session mode: Pve`,
  `2026-09-26 22:05:45.000|${V}|Info|backend|---> Request HTTPS, id [1]: URL: https://gw-pvp.escapefromtarkov.com/client/game/keepalive.`,
  `2026-09-26 22:05:53.064|${V}|Info|application|CompleteSelectedProfile ProfileId:66979f1d05d30f2f7e0506cf AccountId:7690289`,
  '',
].join('\n')
const bytes = Buffer.from(text)

/** A worker in this thread: parses what it is sent, answers on the next turn. */
function fakeWorker(answer: 'parse' | 'error' | 'crash' = 'parse') {
  const listeners = new Map<string, Array<(value: unknown) => void>>()
  const worker = {
    posted: [] as Array<{ message: unknown; transfer?: ArrayBuffer[] }>,
    terminated: false,
    postMessage(message: unknown, transfer?: ArrayBuffer[]) {
      worker.posted.push({ message, transfer })
      const { id, bytes: slice, gatewayMode } = message as { id: number; bytes: Uint8Array; gatewayMode?: 'pvp' }
      queueMicrotask(() => {
        if (answer === 'crash') for (const listener of listeners.get('error') ?? []) listener(new Error('boom'))
        else for (const listener of listeners.get('message') ?? []) listener(answer === 'error' ? { id, error: 'bad' } : { id, ...parseSignalSlice(slice, gatewayMode) })
      })
    },
    on(event: string, listener: (value: unknown) => void) { listeners.set(event, [...(listeners.get(event) ?? []), listener]) },
    terminate: async () => { worker.terminated = true; return 0 },
  }
  return worker
}

afterEach(() => vi.useRealTimers())

describe('the log parser off the main thread', () => {
  it('parses a slice exactly as the reader did', () => {
    expect(parseSignalSlice(bytes)).toEqual(readLogSignalsFrom(text.replace(/\n$/, '')))
    expect(parseSignalSlice(bytes.subarray(0, 60), 'pvp').gatewayMode).toBe('pvp')
  })

  it('sends big slices to the worker (handing over a copy) and keeps small ones here', async () => {
    const worker = fakeWorker()
    const parser = createSliceParser({ spawn: () => worker as unknown as ParserWorker, minBytes: 100 })
    expect(await parser.parse(bytes, 0, 50)).toEqual(parseSignalSlice(bytes.subarray(0, 50)))
    expect(worker.posted).toHaveLength(0)
    expect(await parser.parse(bytes, 0, bytes.length)).toEqual(parseSignalSlice(bytes))
    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0]!.transfer).toHaveLength(1)
    // The buffer read from the file is untouched by the hand-over.
    expect(bytes.toString()).toBe(text)
    parser.stop()
  })

  it('parses here when the worker fails, from then on', async () => {
    const worker = fakeWorker('crash')
    const parser = createSliceParser({ spawn: () => worker as unknown as ParserWorker, minBytes: 1 })
    expect(await parser.parse(bytes, 0, bytes.length)).toEqual(parseSignalSlice(bytes))
    expect(parser.usesWorker()).toBe(false)
    expect(await parser.parse(bytes, 0, bytes.length)).toEqual(parseSignalSlice(bytes))
    expect(worker.posted).toHaveLength(1)
  })

  it('takes a refused slice here, and a worker that cannot start is never tried again', async () => {
    const refusing = createSliceParser({ spawn: () => fakeWorker('error') as unknown as ParserWorker, minBytes: 1 })
    expect(await refusing.parse(bytes, 0, bytes.length)).toEqual(parseSignalSlice(bytes))
    const spawn = vi.fn(() => { throw new Error('no worker here') })
    const failing = createSliceParser({ spawn, minBytes: 1 })
    expect(await failing.parse(bytes, 0, bytes.length)).toEqual(parseSignalSlice(bytes))
    await failing.parse(bytes, 0, bytes.length)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(createSliceParser({ spawn: null }).usesWorker()).toBe(false)
  })

  it('closes an unused worker after a while and starts one again for the next big slice', async () => {
    vi.useFakeTimers()
    const workers: Array<ReturnType<typeof fakeWorker>> = []
    const parser = createSliceParser({ spawn: () => { const worker = fakeWorker(); workers.push(worker); return worker as unknown as ParserWorker }, minBytes: 1, idleMs: 1000 })
    await parser.parse(bytes, 0, bytes.length)
    await vi.advanceTimersByTimeAsync(1000)
    expect(workers[0]!.terminated).toBe(true)
    await parser.parse(bytes, 0, bytes.length)
    expect(workers).toHaveLength(2)
    expect(parser.usesWorker()).toBe(true)
    parser.stop()
  })
})
