import { useSyncExternalStore } from 'react'

/**
 * Whether the app window is in use: visible and focused. While the player is in the game the window sits behind it
 * (or is minimized), and every animation frame it draws is taken from the game — so decorative motion stops:
 * `<html data-app-idle>` is set, endless CSS animations are paused, and loops such as the Gear hangers or a 3D
 * badge should check `isAppActive()` / subscribe with `onAppActivityChange()` and sleep until the window is used again.
 * Work that the overlays or log sync need (IPC answers, timers) is not affected.
 */
type Listener = (active: boolean) => void

const listeners = new Set<Listener>()
let active = readActive()
let users = 0
let stopListening: (() => void) | null = null
const paused = new Set<Animation>()

function readActive() {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden' && document.hasFocus()
}

export function isAppActive() {
  return active
}

export function onAppActivityChange(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** React: true while the window is visible and focused. */
export function useAppActive() {
  return useSyncExternalStore(onAppActivityChange, isAppActive, () => true)
}

function update() {
  const next = readActive()
  if (next === active) return
  active = next
  document.documentElement.toggleAttribute('data-app-idle', !active)
  if (active) resumeAnimations()
  else pauseEndlessAnimations()
  for (const listener of [...listeners]) listener(active)
}

/**
 * Endless CSS animations (pulsing map markers, spinners, blinking status marks) only; one-shot entrance animations
 * keep running so nothing is left half faded in while the window is watched on a second monitor.
 */
function pauseEndlessAnimations() {
  for (const animation of document.getAnimations?.() ?? []) {
    if (animation.playState !== 'running' || animation.effect?.getTiming().iterations !== Infinity) continue
    animation.pause()
    paused.add(animation)
  }
}

function resumeAnimations() {
  for (const animation of paused) if (animation.playState === 'paused') animation.play()
  paused.clear()
}

/** Starts following focus and visibility; the returned function stops it (reference-counted). */
export function startAppActivity() {
  users += 1
  if (!stopListening && typeof window !== 'undefined') {
    // Focus may move into an embedded page (webview, iframe): the window blurs but the document still has focus.
    const later = () => { window.setTimeout(update, 0) }
    // An endless animation that starts while idle (a spinner appearing) is paused as well.
    const started = () => { if (!active) pauseEndlessAnimations() }
    window.addEventListener('focus', update)
    window.addEventListener('blur', later)
    window.addEventListener('pageshow', update)
    document.addEventListener('visibilitychange', update)
    document.addEventListener('animationstart', started, true)
    stopListening = () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', later)
      window.removeEventListener('pageshow', update)
      document.removeEventListener('visibilitychange', update)
      document.removeEventListener('animationstart', started, true)
    }
    active = !readActive()
    update()
  }
  return () => {
    users -= 1
    if (users > 0 || !stopListening) return
    stopListening()
    stopListening = null
    resumeAnimations()
    document.documentElement.removeAttribute('data-app-idle')
    active = true
  }
}
