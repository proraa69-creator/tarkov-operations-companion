import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * The admin panel's sheets over the whole window (owner, 25.11.2026, the PC app's admin panel: the day of «Регистрации и оплаты»
 * opened cut off under the menu). A panel with a blurred background (the «Стекло» style) is the box a `position: fixed` child is
 * laid in, so a sheet drawn inside it slid with the panel; drawn in the page's body it covers the window as on the phone.
 */
export function SheetPortal({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body)
}
