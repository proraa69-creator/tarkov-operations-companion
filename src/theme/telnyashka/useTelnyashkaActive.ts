import { useSyncExternalStore } from 'react'

export const TELNYASHKA_THEME_ID = 'telnyashka'

const isActive = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === TELNYASHKA_THEME_ID

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** True while `<html data-theme="telnyashka">` is set; follows the attribute live. */
export function useTelnyashkaActive() {
  return useSyncExternalStore(subscribe, isActive, () => false)
}
