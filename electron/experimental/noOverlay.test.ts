import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Owner, 15.10.2026: «убирай функции оверлей, карта поверх игры и информация о предмете поверх игры». The main process
// runs only inside Electron with the Windows functions, so its sources are read: nothing may draw over the game.
const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')
const game = read('experimental/index.ts')
const main = read('main.ts')
const preloads = [read('preload.ts'), read('preload.cjs')]

describe('no in-game overlays', () => {
  it('the game functions open no window: no BrowserWindow, no always-on-top, transparent or click-through window', () => {
    expect(game).not.toMatch(/new BrowserWindow/)
    for (const pattern of [/setAlwaysOnTop/, /alwaysOnTop/, /transparent:/, /setIgnoreMouseEvents/, /showInactive/, /visibleOnFullScreen/]) {
      expect(game, String(pattern)).not.toMatch(pattern)
      expect(main, String(pattern)).not.toMatch(pattern)
    }
    expect(main.match(/new BrowserWindow\(/g)?.length, 'the main window only').toBe(1)
    expect(main).not.toMatch(/load: loadRenderer|preload: join\(appDir, '\.\.\/\.\.\/electron\/preload\.cjs'\),\n\s*load/)
  })

  it('no overlay IPC is handled or exposed', () => {
    expect(game).not.toMatch(/'overlay:/)
    expect(game).not.toMatch(/experimental:toggle-minimap/)
    for (const preload of preloads) {
      expect(preload).not.toMatch(/overlay:|onOverlay|overlayResize|overlayDrag|overlayZones|overlayHold|overlaySetInteractive|toggleMinimap/)
      expect(preload).toMatch(/onItem: .*'experimental:item'/)
    }
  })

  it('no overlay hotkey: only the item key and the Collector scan key are watched', () => {
    expect(game).not.toMatch(/minimapKey/)
    const hook = game.slice(game.indexOf('function startHook('), game.indexOf('\n}\n', game.indexOf('function startHook(')))
    expect(hook).toMatch(/settings\.itemKey/)
    expect(hook).toMatch(/settings\.collectorKey/)
    expect(hook.match(/settings\.\w+Key/g)?.every((key) => key === 'settings.itemKey' || key === 'settings.collectorKey')).toBe(true)
  })

  it('a recognised item goes to the main window for «Карты», not to a window of its own', () => {
    const lookup = game.slice(game.indexOf('async function lookupItem('), game.indexOf('\n}\n', game.indexOf('async function lookupItem(')))
    expect(lookup).toMatch(/sendItem\(\{ state: 'loading' \}\)/)
    expect(lookup).toMatch(/sendItem\(answer \?\? \{ state: 'not-found'/)
    expect(game).toMatch(/webContents\.send\('experimental:item', payload\)/)
  })

  it('the position still comes from the game\'s screenshots, gated by the owner\'s switch and the player\'s', () => {
    const control = read('experimental/trackingControl.ts')
    expect(control).toMatch(/const on = settings\.tracking && trackingOn\(settings\)/)
    expect(control).toMatch(/if \(on\) void Promise\.resolve\(deps\.tracker\.start\(\)\)/)
    expect(game).toMatch(/createTrackingControl\(\{\s*tracker,/)
    expect(game).toMatch(/webContents\.send\('experimental:position', position\)/)
  })
})
