import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFileSync(join(__dirname, file), 'utf8')

/** Every IPC channel used by preload.ts (the typed source) must also be in preload.cjs (what Electron loads). */
const channels = (file: string) => new Set(source(file).match(/ipcRenderer\.(?:invoke|send|sendSync|on)\('[a-z-]+:[a-z-]+'/g) ?? [])

/** Each IPC call as written, its arguments included, by channel: «ipcRenderer.invoke('account:register', …)». */
function calls(file: string) {
  const text = source(file)
  const found = new Map<string, string[]>()
  for (const match of text.matchAll(/ipcRenderer\.(?:invoke|send|sendSync|on)\(/g)) {
    let end = match.index + match[0].length
    for (let depth = 1; depth > 0 && end < text.length; end += 1) depth += text[end] === '(' ? 1 : text[end] === ')' ? -1 : 0
    const call = text.slice(match.index, end).replace(/\s+/g, ' ')
    const channel = /\('([a-z-]+:[a-z-]+)'/.exec(call)?.[1]
    if (channel) found.set(channel, [...(found.get(channel) ?? []), call])
  }
  return found
}

describe('preload.cjs mirrors preload.ts', () => {
  it('exposes every channel the typed preload exposes', () => {
    const cjs = channels('preload.cjs')
    expect([...channels('preload.ts')].filter((channel) => !cjs.has(channel))).toEqual([])
  })

  // The events the page listens to go through subscribe(): the game's exit list never reached the map because only
  // preload.ts listened to 'game:raid-extracts' (owner, 19.11.2026: «Выходы на карте до сих пор не обнаруживаются»).
  it('listens to every event the typed preload listens to', () => {
    const listened = (file: string) => new Set(source(file).match(/subscribe\('[a-z-]+:[a-z-]+'/g) ?? [])
    const cjs = listened('preload.cjs')
    expect([...listened('preload.ts')].filter((channel) => !cjs.has(channel))).toEqual([])
    expect(cjs.has("subscribe('game:raid-extracts'")).toBe(true)
  })

  // An argument added to preload.ts only never reaches the main process: the country of a registration and the saved
  // Logs folder were dropped that way (13.10.2026).
  it('passes the same arguments on every channel', () => {
    const cjs = calls('preload.cjs')
    const differing = [...calls('preload.ts')].filter(([channel, list]) => JSON.stringify(list) !== JSON.stringify(cjs.get(channel) ?? []))
    expect(differing).toEqual([])
  })
})
