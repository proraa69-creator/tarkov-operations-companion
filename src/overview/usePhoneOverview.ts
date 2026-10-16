import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EASE_IN_OUT, canAnimate } from '../shared/motion'
import { defaultPhoneLayout, isDefaultPhoneLayout, loadPhoneLayout, movePhoneBlock, savePhoneLayout, togglePhoneNarrow, type PhoneLayout } from './phoneLayout'

const REFLOW_MS = 240

/**
 * «Настроить блоки» on the phone (overview/phoneLayout.ts): ↑ / ↓ move a block one place, «узкий» puts the two counters
 * side by side. The other blocks slide to their new places (FLIP, 240 ms on the strong ease-in-out), and a moved block
 * that left the screen is scrolled back into view. Esc leaves the editing mode.
 */
export function usePhoneOverview() {
  const [layout, setLayout] = useState<PhoneLayout>(() => loadPhoneLayout())
  const [editing, setEditing] = useState(false)
  const elements = useRef(new Map<string, HTMLElement>())
  const layoutRef = useRef(layout)
  const pending = useRef<{ before: Map<string, DOMRect>; moved?: string } | null>(null)

  useEffect(() => savePhoneLayout(layout), [layout])

  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element)
    else elements.current.delete(id)
  }, [])

  const apply = useCallback((next: PhoneLayout, moved?: string) => {
    if (next === layoutRef.current) return
    const before = new Map<string, DOMRect>()
    for (const [id, element] of elements.current) before.set(id, element.getBoundingClientRect())
    pending.current = { before, moved }
    layoutRef.current = next
    setLayout(next)
  }, [])

  useLayoutEffect(() => {
    layoutRef.current = layout
    const flip = pending.current
    if (!flip) return
    pending.current = null
    if (canAnimate()) {
      for (const [id, element] of elements.current) {
        const was = flip.before.get(id)
        if (!was) continue
        const now = element.getBoundingClientRect()
        const dx = was.left - now.left
        const dy = was.top - now.top
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
        if (typeof element.animate !== 'function') continue
        element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: REFLOW_MS, easing: EASE_IN_OUT })
      }
    }
    const moved = flip.moved ? elements.current.get(flip.moved) : undefined
    if (moved && typeof moved.scrollIntoView === 'function') {
      const box = moved.getBoundingClientRect()
      if (box.top < 70 || box.bottom > window.innerHeight - 80) moved.scrollIntoView({ block: 'center', behavior: canAnimate() ? 'smooth' : 'auto' })
    }
  }, [layout])

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setEditing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  return {
    layout,
    editing,
    isDefault: isDefaultPhoneLayout(layout),
    register,
    toggleEditing: useCallback(() => setEditing((value) => !value), []),
    reset: useCallback(() => apply(defaultPhoneLayout()), [apply]),
    move: useCallback((id: string, step: -1 | 1) => apply(movePhoneBlock(layoutRef.current, id, step), id), [apply]),
    toggleNarrow: useCallback((id: string) => apply(togglePhoneNarrow(layoutRef.current, id), id), [apply]),
  }
}

export type PhoneOverview = ReturnType<typeof usePhoneOverview>
