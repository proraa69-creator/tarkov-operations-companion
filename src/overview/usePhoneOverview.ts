import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EASE_IN_OUT, canAnimate } from '../shared/motion'
import { isDefaultPhoneLayout, loadPhoneLayout, resizePhoneBlock, savePhoneLayout, setPhoneHalf, swapPhoneBlocks, type PhoneBlockSize, type PhoneLayout } from './phoneLayout'
import { basePhoneLayout, phoneWithoutHidden } from './overviewDefaults'
import { useOverviewDefaults } from './overviewDefaultsStore'

const REFLOW_MS = 240

/**
 * «Настроить блоки» on the phone (overview/phoneLayout.ts): a block held down lifts and is dropped on another to swap
 * places (owner, 28.10.2026: «перетаскиваться удержанием, а не стрелочками»), «пополам» / «во всю ширину» on every block. The other blocks slide to their new places (FLIP, 240 ms on the strong ease-in-out), and a moved block
 * that left the screen is scrolled back into view. Esc leaves the editing mode.
 */
export function usePhoneOverview() {
  // «Админ панель» → «Блоки» (overviewDefaults.ts): the owner's order and hidden blocks, until the player's own order.
  const defaults = useOverviewDefaults()
  const base = useMemo(() => basePhoneLayout(defaults), [defaults])
  const hidden = defaults?.hidden
  const [layout, setLayout] = useState<PhoneLayout>(() => phoneWithoutHidden(loadPhoneLayout(undefined, base), hidden ?? []))
  const [editing, setEditing] = useState(false)
  /** The block held up now and the one under the finger. */
  const [dragging, setDragging] = useState<{ id: string; over?: string } | null>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const layoutRef = useRef(layout)
  const pending = useRef<{ before: Map<string, DOMRect>; moved?: string } | null>(null)
  const baseRef = useRef(base)
  useEffect(() => { baseRef.current = base })

  useEffect(() => savePhoneLayout(layout, undefined, baseRef.current), [layout])

  // New defaults from the owner reach a phone without an own order at once (not while the blocks are being arranged).
  useEffect(() => {
    if (editing) return
    const next = phoneWithoutHidden(loadPhoneLayout(undefined, base), hidden ?? [])
    if (isDefaultPhoneLayout(next, layoutRef.current)) return
    layoutRef.current = next
    setLayout(next)
  }, [base, hidden, editing])

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
    isDefault: isDefaultPhoneLayout(layout, base),
    register,
    toggleEditing: useCallback(() => { setDragging(null); setEditing((value) => !value) }, []),
    reset: useCallback(() => apply(baseRef.current), [apply]),
    dragging,
    setDragging,
    swap: useCallback((id: string, target: string) => apply(swapPhoneBlocks(layoutRef.current, id, target)), [apply]),
    setHalf: useCallback((id: string, half: boolean) => apply(setPhoneHalf(layoutRef.current, id, half), id), [apply]),
    // Dragging a corner: the size follows the finger at once (no slide of the others: they reflow under the finger).
    resize: useCallback((id: string, size: PhoneBlockSize | undefined) => {
      const next = resizePhoneBlock(layoutRef.current, id, size)
      layoutRef.current = next
      setLayout(next)
    }, []),
  }
}

export type PhoneOverview = ReturnType<typeof usePhoneOverview>
