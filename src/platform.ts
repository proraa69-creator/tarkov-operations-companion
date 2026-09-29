/**
 * Where the renderer runs: the Windows desktop shell (Electron, `window.tarkovDesktop`), the iOS/Android app
 * (Capacitor) or a plain browser. Desktop-only features (EFT log reading, screenshots, overlay hotkeys, item OCR,
 * the minimap overlay window) are gated on `isDesktopShell()`; the phone layout on `isMobileLayout()`.
 */
import { Capacitor } from '@capacitor/core'
import { useSyncExternalStore } from 'react'

/** Phone layout breakpoint: at or below this viewport width the bottom tab bar replaces the sidebar. */
export const MOBILE_MAX_WIDTH = 700

export function isNative() {
  try { return Capacitor.isNativePlatform() } catch { return false }
}

/** 'ios' | 'android' | 'web' */
export function nativePlatform() {
  try { return Capacitor.getPlatform() } catch { return 'web' }
}

export function isDesktopShell() {
  return typeof window !== 'undefined' && Boolean(window.tarkovDesktop)
}

export function isNarrowViewport(width = typeof window === 'undefined' ? Infinity : window.innerWidth) {
  return width <= MOBILE_MAX_WIDTH
}

/** The phone layout: always in the native app, and in a browser at phone widths (never in the desktop shell). */
export function isMobileLayout(options: { native?: boolean; desktop?: boolean; width?: number } = {}) {
  const native = options.native ?? isNative()
  const desktop = options.desktop ?? isDesktopShell()
  if (native) return true
  if (desktop) return false
  return isNarrowViewport(options.width)
}

/**
 * Keeps `<html data-layout="mobile">` and `data-platform` in sync with the viewport, so the CSS in
 * styles/mobile.css can switch layouts without every component re-rendering. Returns a cleanup function.
 */
export function installLayoutAttributes() {
  if (typeof document === 'undefined') return () => {}
  const root = document.documentElement
  const apply = () => {
    if (isMobileLayout()) root.setAttribute('data-layout', 'mobile')
    else root.removeAttribute('data-layout')
  }
  root.setAttribute('data-platform', isNative() ? nativePlatform() : isDesktopShell() ? 'desktop' : 'web')
  apply()
  window.addEventListener('resize', apply)
  return () => window.removeEventListener('resize', apply)
}

/** React hook: re-renders when the viewport crosses the phone breakpoint. */
const subscribeResize = (listener: () => void) => {
  window.addEventListener('resize', listener)
  return () => window.removeEventListener('resize', listener)
}

export function useMobileLayout() {
  return useSyncExternalStore(subscribeResize, () => isMobileLayout(), () => false)
}
