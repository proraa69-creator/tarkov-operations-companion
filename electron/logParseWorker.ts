import { parentPort } from 'node:worker_threads'
import type { RaidMode } from '../src/domain/types.js'
import { parseSignalSlice } from './logParser.js'

/** The worker thread of electron/logParser.ts: a slice of a log in, its signals out. Reads no file, keeps nothing. */
parentPort?.on('message', (message: { id: number; bytes: Uint8Array; gatewayMode?: RaidMode }) => {
  try {
    parentPort!.postMessage({ id: message.id, ...parseSignalSlice(message.bytes, message.gatewayMode) })
  } catch (error) {
    parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) })
  }
})
