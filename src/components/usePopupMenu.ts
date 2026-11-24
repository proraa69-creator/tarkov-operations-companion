import { useEffect, useRef } from 'react'

/**
 * A right-click menu while it is open (`open`): Escape, a press elsewhere or a resized window closes it; its first button
 * takes the focus. `onClose` must keep its identity between renders.
 */
export function usePopupMenu(open: unknown, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onClose)
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onClose)
    }
  }, [open, onClose])
  return ref
}
