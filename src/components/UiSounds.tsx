import { useEffect } from 'react'
import { playUiSound, preloadUiSounds } from '../shared/uiSound'

const INTERACTIVE = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  'summary',
  'select',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '.toggle',
].join(',')

const HOVER_GAP_MS = 45

function interactiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  const element = target.closest(INTERACTIVE)
  if (!element || element.closest('.leaflet-container')) return null
  if (element.matches(':disabled, [aria-disabled="true"]')) return null
  return element
}

export function UiSounds() {
  useEffect(() => {
    preloadUiSounds()
    let hovered: Element | null = null
    let lastHoverAt = 0

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const element = interactiveTarget(event.target)
      if (element === hovered) return
      hovered = element
      if (!element) return
      const now = performance.now()
      if (now - lastHoverAt < HOVER_GAP_MS) return
      lastHoverAt = now
      playUiSound('hover')
    }
    // A finger plays the click on the tap itself (the click event), not when it touches the screen: a touch that
    // turns into a scroll is no press (owner, 13.10.2026: «при листании вверх вниз не нажимались кнопки, только при
    // конкретном нажатии»). The mouse keeps the instant click on press.
    let touchPress = false
    const onDown = (event: PointerEvent) => {
      touchPress = event.pointerType === 'touch' || event.pointerType === 'pen'
      if (touchPress || event.button !== 0 || !interactiveTarget(event.target)) return
      playUiSound('click')
    }
    const onClick = (event: MouseEvent) => {
      if (!touchPress) return
      touchPress = false
      if (interactiveTarget(event.target)) playUiSound('click')
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && interactiveTarget(event.target)) playUiSound('click')
    }

    document.addEventListener('pointerover', onOver, { passive: true })
    document.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('click', onClick, { capture: true, passive: true })
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('click', onClick, { capture: true })
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return null
}
