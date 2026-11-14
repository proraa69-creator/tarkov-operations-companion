import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Owner, 07.11.2026: «Окна не должны выходить выше него» (the level of the page on a phone, --window-top). A new full-screen window
 * has to be named in the block of styles/mobile.css, or be told apart here.
 */
/** Full-screen, but no window: decoration, a guide's own layer that places its card, the bars' backdrops, a whole-screen mode (the map's, the quest tree's on the PC). */
const NOT_WINDOWS = new Set(['frg-layer', 'gear-hangers', 'quest-sheet-backdrop', 'mobile-more-backdrop', 'map-stage', 'is-fullscreen', 'is-map-fullscreen', 'quest-tree-page'])
const OWN_RULE = new Set(['search-overlay', 'gallery-overlay', 'support-image-lightbox', 'admin-report-lightbox', 'requests-viewer'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : name.endsWith('.css') ? [path] : []
  })
}

const FULL_SCREEN = /\.([\w-]+)\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/g

describe('windows on a phone', () => {
  const mobile = readFileSync('src/styles/mobile.css', 'utf8')
  const block = mobile.slice(mobile.indexOf('Windows: none above the level'))

  it('the level is where a page starts', () => {
    expect(mobile).toContain('--window-top: calc(var(--topbar) + var(--announcement-height, 0px) + 12px)')
    expect(mobile).toContain('padding: calc(var(--topbar) + 12px)')
  })

  it('every full-screen window keeps to it', () => {
    const found = new Set(files('src').flatMap((path) => [...readFileSync(path, 'utf8').matchAll(FULL_SCREEN)].map((match) => match[1]!)))
    expect(found.size).toBeGreaterThan(10)
    const missing = [...found].filter((name) => !NOT_WINDOWS.has(name) && !name.startsWith('registration') && !block.includes(`.${name}`) && !(OWN_RULE.has(name) && mobile.includes(`.${name}`)))
    expect(missing).toEqual([])
  })

  it('the app window and its neighbours use it, not the height of the status bar alone', () => {
    expect(mobile).not.toContain('.search-overlay { padding-top: calc(var(--safe-top)')
    expect(readFileSync('src/support/supportChat.css', 'utf8')).toContain('padding: var(--window-top) 0 0')
  })
})
