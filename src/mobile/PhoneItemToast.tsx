import { useEffect, useRef, useState } from 'react'
import { Package, X } from 'lucide-react'
import { useRecognisedItem } from '../items/recognisedItem'
import type { ItemOverlayInfo } from '../overlay/types'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'
import { isNative } from '../platform'
import { prepareItemNotifications, showItemNotification } from './itemNotification'

/** How long the card stays (owner, 17.10.2026: «уведомление должно появляться в верхней части экрана на 10 секунд»). */
export const ITEM_TOAST_MS = 10_000
/** A swipe up this far closes the banner, as a phone's own notification. */
const SWIPE_CLOSE_PX = 28

/**
 * «Информация о предмете» from the PC, on the phone (owner, 17.10.2026): the item the player looked up in the raid comes
 * through the live relay (mobile/livePosition.ts). In the phone app it is the phone's own notification at the top of the
 * screen (owner, 18.10.2026: «как верхний блок уведомлений на телефоне», mobile/itemNotification.ts); where the phone
 * cannot show one (no permission, a browser) this banner looks and behaves like one: at the top over every window, for
 * 10 seconds, the next item replaces it, a tap or a swipe up closes it.
 */
export function PhoneItemToast() {
  const item = useRecognisedItem()
  const [shown, setShown] = useState<{ at: number; payload: ItemOverlayInfo } | null>(null)
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)

  // The permission is asked when the phone app starts, not at the first item (that one would be lost to the question).
  useEffect(() => { void prepareItemNotifications() }, [])

  useEffect(() => {
    if (!item || item.from !== 'server' || item.payload.state !== 'found') return
    const next = { at: item.at, payload: item.payload as ItemOverlayInfo }
    if (!isNative()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a new item from the relay replaces the card
      setShown((current) => current?.at === next.at ? current : next)
      return
    }
    let alive = true
    void showItemNotification(next.payload).then((system) => {
      if (alive) setShown((current) => system ? null : current?.at === next.at ? current : next)
    })
    return () => { alive = false }
  }, [item])

  useEffect(() => {
    if (!shown) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new card starts where it belongs
    setDrag(0)
    const timer = window.setTimeout(() => setShown(null), ITEM_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [shown])

  if (!shown) return null
  const { payload } = shown
  const needs = [
    ...payload.quests.slice(0, 2).map((quest) => `${quest.name}${quest.count > 1 ? ` ×${quest.count}` : ''}`),
    ...(payload.quests.length > 2 ? [`ещё ${payload.quests.length - 2}`] : []),
  ]
  const close = () => { start.current = null; setShown(null) }
  return <div
    className="phone-item-toast"
    key={shown.at}
    role="status"
    aria-live="polite"
    style={drag ? { transform: `translate(-50%, ${drag}px)`, transition: 'none' } : undefined}
    onClick={close}
    onPointerDown={(event) => { start.current = event.clientY }}
    onPointerMove={(event) => { if (start.current !== null) setDrag(Math.min(0, event.clientY - start.current)) }}
    onPointerUp={() => { if (drag <= -SWIPE_CLOSE_PX) close(); else { start.current = null; setDrag(0) } }}
    onPointerCancel={() => { start.current = null; setDrag(0) }}
  >
    <div className="phone-item-toast-app">
      <span className="phone-item-toast-app-icon" aria-hidden="true">R</span>
      <span>Raid OS</span>
      <span className="phone-item-toast-when">{uiText('сейчас')}</span>
      <button type="button" className="phone-item-toast-close" aria-label={uiText('Закрыть')} onClick={(event) => { event.stopPropagation(); close() }}><X size={13} /></button>
    </div>
    <div className="phone-item-toast-main">
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
    </div>
    <span className="phone-item-toast-grabber" aria-hidden="true" />
  </div>
}
