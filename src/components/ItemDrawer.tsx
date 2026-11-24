import { useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Item } from '../domain/types'
import { FleaItemDetail } from './FleaItemDetail'
import './itemDrawer.css'

/**
 * An item's card from «Барахолка» on the right of the window, over the page (owner, 16.11.2026, report 171: «нажатие на
 * модуль открывает справа окно с предметом, как на Барахолке»). Closed by its cross, Escape or a click beside it; the
 * phone shows it as a sheet from the bottom, as «Барахолка» does.
 */
export function ItemDrawer({ item, onClose, noPrices }: { item: Item; onClose: () => void; noPrices?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const beside = (event: ReactMouseEvent) => { if (event.target === event.currentTarget) onClose() }
  return createPortal(<div className="item-drawer-backdrop" onMouseDown={beside} data-testid="item-drawer">
    {/* The quest link inside leaves this page: the card goes with it. */}
    <div className="item-drawer" onClickCapture={(event) => { if ((event.target as HTMLElement).closest('a[href]')) onClose() }}>
      <FleaItemDetail item={item} onClose={onClose} noPrices={noPrices} />
    </div>
  </div>, document.body)
}
