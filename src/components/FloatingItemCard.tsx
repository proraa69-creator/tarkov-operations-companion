import { useLocation } from 'react-router-dom'
import { MapItemCard } from './MapItemCard'

/**
 * The recognised item on every tab, not only on «Карты» (owner, 07.11.2026: «окно цены вылезало по всем вкладкам, не только на карте,
 * а в какой вкладке он не находился бы, окно цены будет появляться всегда, везде»). The same card as on the map, at the top left of the
 * page under the top bar; on «Карты» the map keeps its own under «Вид» (pages/MapsPage.tsx), so it is never shown twice.
 */
export function FloatingItemCard() {
  const { pathname } = useLocation()
  if (pathname === '/maps' || pathname.startsWith('/maps/')) return null
  return <div className="floating-item-card"><MapItemCard /></div>
}
