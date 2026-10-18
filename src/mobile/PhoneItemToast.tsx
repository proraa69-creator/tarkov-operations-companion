import { useEffect, useState } from 'react'
import { Package, X } from 'lucide-react'
import { useRecognisedItem } from '../items/recognisedItem'
import type { ItemOverlayInfo } from '../overlay/types'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'

/** How long the card stays (owner, 17.10.2026: «уведомление должно появляться в верхней части экрана на 10 секунд»). */
export const ITEM_TOAST_MS = 10_000

/**
 * «Информация о предмете» from the PC, on the phone (owner, 17.10.2026): the item the player looked up in the raid comes
 * through the live relay (mobile/livePosition.ts) and shows as a compact card at the top of the screen, over every
 * window, for 10 seconds; the next item replaces it at once. A tap closes it.
 */
export function PhoneItemToast() {
  const item = useRecognisedItem()
  const [shown, setShown] = useState<{ at: number; payload: ItemOverlayInfo } | null>(null)

  useEffect(() => {
    if (!item || item.from !== 'server' || item.payload.state !== 'found') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new item from the relay replaces the card
    setShown((current) => current?.at === item.at ? current : { at: item.at, payload: item.payload as ItemOverlayInfo })
  }, [item])

  useEffect(() => {
    if (!shown) return
    const timer = window.setTimeout(() => setShown(null), ITEM_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [shown])

  if (!shown) return null
  const { payload } = shown
  const needs = [
    ...payload.quests.slice(0, 2).map((quest) => `${quest.name}${quest.count > 1 ? ` ×${quest.count}` : ''}`),
    ...(payload.quests.length > 2 ? [`ещё ${payload.quests.length - 2}`] : []),
  ]
  return <div className="phone-item-toast" key={shown.at} role="status" aria-live="polite" onClick={() => setShown(null)}>
    {payload.iconUrl ? <img src={payload.iconUrl} alt="" /> : <span className="phone-item-toast-icon"><Package size={18} /></span>}
    <div className="phone-item-toast-body">
      <div className="phone-item-toast-title">
        <strong>{uiText(payload.shortName || payload.name)}</strong>
        {payload.kappa && <span className="phone-item-toast-tag is-kappa">{uiText('Каппа')}</span>}
        {payload.mate && <span className="phone-item-toast-tag">{uiText(payload.mateNames?.length ? payload.mateNames.join(', ') : 'Друг')}</span>}
      </div>
      <div className="phone-item-toast-prices">
        {payload.fleaPrice !== undefined && <span>{uiText(payload.fleaAverage ? 'Барахолка (сред.) ' : 'Барахолка ')}<b>{formatPrice(payload.fleaPrice)}</b></span>}
        {payload.bestTrader && <span>{uiText(payload.bestTrader.name)} <b>{formatPrice(payload.bestTrader.price)}</b></span>}
        {payload.fleaPrice === undefined && !payload.bestTrader && <span className="dim">{uiText('Цена неизвестна')}</span>}
      </div>
      {needs.length > 0 && <div className="phone-item-toast-needs">{uiText('Нужен: ')}{uiText(needs.join(' · '))}</div>}
    </div>
    <button type="button" className="phone-item-toast-close" aria-label={uiText('Закрыть')} onClick={(event) => { event.stopPropagation(); setShown(null) }}><X size={14} /></button>
    <span className="phone-item-toast-timer" aria-hidden="true" />
  </div>
}
