import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './notifications.css'

/**
 * Owner, 07.11.2026: «все уведомления должны появляться справа снизу, не перекрывая весь экран. Просто вылезает окошечко, которое не
 * мешает интерфейсу, и само закрывается там через 7 секунд». What was said stays in «Уведомления» (notificationCenter.ts).
 */
export const TOAST_MS = 7_000

/** Into the app's one corner (src/app/App.tsx), so messages stand one above another; a locked screen has none and gets its own. */
export function ToastDock({ children }: { children: ReactNode }) {
  const dock = document.querySelector('.toast-dock:not(.is-own)')
  return createPortal(dock ? children : <div className="toast-dock is-own">{children}</div>, dock ?? document.body)
}

/** Closes after {@link TOAST_MS}. `hold`: a mouse resting on the message, or anything else that should keep it, waits; it then gets the full time again. */
export function useToastTimer(close: () => void, hold = false) {
  const latest = useRef(close)
  useEffect(() => { latest.current = close })
  useEffect(() => {
    if (hold) return
    const timer = window.setTimeout(() => latest.current(), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [hold])
}
