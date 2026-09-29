import { useSyncExternalStore } from 'react'

export const GEAR_THEME_ID = 'gear'

const isActive = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === GEAR_THEME_ID

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** True while `<html data-theme="gear">` is set; follows the attribute live. */
export function useGearActive() {
  return useSyncExternalStore(subscribe, isActive, () => false)
}

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  query?.addEventListener?.('change', onChange)
  return () => query?.removeEventListener?.('change', onChange)
}
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The user's reduced-motion preference, live. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, reducedMotion, () => false)
}
