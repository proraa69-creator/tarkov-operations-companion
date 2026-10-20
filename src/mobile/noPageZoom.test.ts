// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { installNoPageZoom, NO_ZOOM_VIEWPORT } from './noPageZoom'

/** Phone apps: an accidental double tap or pinch never zooms the interface (owner, 20.10.2026). */
describe('installNoPageZoom', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('makes the viewport non-scalable and cancels the iOS pinch gesture', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'
    const uninstall = installNoPageZoom()
    expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content).toBe(NO_ZOOM_VIEWPORT)
    expect(NO_ZOOM_VIEWPORT).toContain('user-scalable=no')
    expect(NO_ZOOM_VIEWPORT).toContain('viewport-fit=cover')
    expect(document.documentElement.hasAttribute('data-no-zoom')).toBe(true)
    const pinch = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
    uninstall()
    const after = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('adds the viewport tag when the page has none', () => {
    installNoPageZoom()()
    expect(document.querySelectorAll('meta[name="viewport"]')).toHaveLength(1)
  })
})
