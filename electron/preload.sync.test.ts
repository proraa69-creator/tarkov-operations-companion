import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Every IPC channel used by preload.ts (the typed source) must also be in preload.cjs (what Electron loads). */
const channels = (file: string) => new Set(readFileSync(join(__dirname, file), 'utf8').match(/ipcRenderer\.(?:invoke|send|sendSync|on)\('[a-z-]+:[a-z-]+'/g) ?? [])

describe('preload.cjs mirrors preload.ts', () => {
  it('exposes every channel the typed preload exposes', () => {
    const cjs = channels('preload.cjs')
    expect([...channels('preload.ts')].filter((channel) => !cjs.has(channel))).toEqual([])
  })
})
