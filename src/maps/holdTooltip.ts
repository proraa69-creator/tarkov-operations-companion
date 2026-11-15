import type { Marker, Tooltip } from 'leaflet'

/** The way from the point to its card crosses a small gap: the card waits this long for the mouse. */
export const TOOLTIP_HOLD_MS = 350

const markers = new WeakSet<Marker>()
const cards = new WeakSet<HTMLElement>()
const timers = new WeakMap<Marker, ReturnType<typeof setTimeout>>()

/**
 * A quest point's card stays while the mouse goes on to its photo (report 167; owner, 15.11.2026: «чтобы можно было
 * переместить мышку направо на этот блок с фото и посмотреть фотографии»). Leaflet closes a card as the mouse leaves its
 * point; here it closes a moment later, and not while the mouse is on the card's photo (`.mmt-place-photo`, the one part of
 * the card that takes the mouse). Called on every `tooltipopen`: a card bound again (another marker style) is set up again.
 */
export function holdTooltipOnHover(marker: Marker, tooltip: Tooltip) {
  const hold = () => clearTimeout(timers.get(marker))
  const leave = () => {
    hold()
    timers.set(marker, setTimeout(() => marker.closeTooltip(), TOOLTIP_HOLD_MS))
  }
  // Leaflet's own «mouseout → closeTooltip» (Tooltip.js _initTooltipInteractions), bound again with every card.
  marker.off('mouseout', marker.closeTooltip)
  if (!markers.has(marker)) {
    markers.add(marker)
    marker.on('mouseout', leave)
    marker.on('mouseover', hold)
    marker.on('remove', hold)
  }
  const card = tooltip.getElement()
  if (card && !cards.has(card)) {
    cards.add(card)
    card.addEventListener('mouseover', hold)
    card.addEventListener('mouseout', (event) => { if (!card.contains(event.relatedTarget as Node | null)) leave() })
  }
}
