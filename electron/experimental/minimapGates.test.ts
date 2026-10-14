import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The main process's gates for the owner's two switches (settings.ts minimapOn / minimapOverlayOn). index.ts runs only
// inside Electron with the Windows functions, so its source is read: which gate guards which part.
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const body = (name: string) => {
  const start = source.indexOf(`function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('\n}\n', start))
}

describe('the minimap window and the tracking follow different gates', () => {
  it('the window, its key and «Показать / скрыть» need the window switch too', () => {
    expect(body('toggleMinimap')).toMatch(/if \(!minimapOverlayOn\(readSettings\(\)\)\) return false/)
    expect(body('applySettings')).toMatch(/if \(!minimapOverlayOn\(settings\)\) releaseMinimap\(\)/)
    const hook = body('startHook')
    expect(hook).toMatch(/const map = keyDown\([^)]*\)[^\n]*&& minimapOverlayOn\(settings\)/)
    expect(hook).toMatch(/const isMapKey = minimapOverlayOn\(settings\) &&/)
    expect(body('noteScreenshotFile')).toMatch(/!minimapOverlayOn\(settings\)/)
  })

  it('the screenshots folder\'s watch and the position need only the first switch and the player\'s own', () => {
    expect(body('applySettings')).toMatch(/if \(settings\.tracking && minimapOn\(settings\)\) void tracker\.start\(\)/)
    expect(source).toMatch(/const freshPosition = \(\) => lastPosition && minimapOn\(readSettings\(\)\)/)
  })

  it('takes the window switch from the renderer; a caller without it keeps the window on', () => {
    expect(source).toMatch(/'experimental:set-remote-minimap', \(_event, enabled: unknown, overlay\?: unknown\) => applyRemoteMinimap\(enabled === true, overlay !== false\)/)
  })
})
