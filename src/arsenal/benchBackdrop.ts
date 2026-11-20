import { useSyncExternalStore } from 'react'

/**
 * The bench's backdrop (owner, 20.11.2026: «на фоне оружия… размытый такой лес… в стиле каждой темы… у стиля каждой темы должна
 * быть своя картинка фона. Размытая, как будто оружие находится на фоне»): a place in the game shot in the offline copy for each
 * colour scheme (src/assets/bench-backgrounds/<theme>.webp), blurred and darkened under the weapon. A scheme with no shot of its own
 * takes the main one's («tarkov»); none at all — the bench as it was.
 */
const shots = import.meta.glob<string>('../assets/bench-backgrounds/*.webp', { eager: true, import: 'default' })
const byTheme = new Map(Object.entries(shots).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]))

const themeOf = () => (typeof document === 'undefined' ? '' : document.documentElement.dataset.theme ?? '')

function subscribe(onChange: () => void) {
  if (typeof MutationObserver === 'undefined') return () => undefined
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

export function benchBackdrop(theme: string): string | undefined {
  return byTheme.get(theme) ?? byTheme.get('tarkov')
}

/** The backdrop of the scheme on now; follows a change of scheme live. */
export function useBenchBackdrop(): string | undefined {
  return benchBackdrop(useSyncExternalStore(subscribe, themeOf, () => ''))
}
