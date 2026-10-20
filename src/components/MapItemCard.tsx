import { X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { closeRecognisedItem, useRecognisedItem } from '../items/recognisedItem'
import type { ItemOverlayInfo } from '../overlay/types'
import '../styles/mapItemCard.css'

const rub = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`

/**
 * The recognised item on «Карты» (owner, 15.10.2026: «Информация о предмете будет появляться слева наверху на карте»):
 * picture and name, the flea and best trader price, and only whether the Collector («Каппа») or a friend needs it —
 * no quest list (owner, 20.10.2026: «сколько нужно на квест убираем, оставляем только если нужно на капу… либо капа,
 * либо ник друга»). At the left edge of the map's HUD on a line of its own, never over the map controls (their menus
 * open over it). Stays until the next item or «Закрыть». The same on the phone, from the PC of the account
 * (items/recognisedItem.ts).
 */
export function MapItemCard() {
  const item = useRecognisedItem()
  if (!item) return null
  const { payload } = item
  return (
    <div className="map-item-card-row">
      <section className={`map-item-card is-${payload.state}`} aria-label={uiText('Информация о предмете')} aria-live="polite">
        <button type="button" className="map-item-card-close" onClick={closeRecognisedItem} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={14} /></button>
        {payload.state === 'loading' && <div className="map-item-card-status"><span className="map-item-card-spinner" aria-hidden="true" />{uiText('Распознаю предмет…')}</div>}
        {payload.state === 'not-found' && (
          <div className="map-item-card-status is-miss">
            <strong>{uiText('Предмет не распознан')}</strong>
            <small>{uiText('Наведите курсор на предмет в игре, дождитесь подсказки с названием и нажмите клавишу ещё раз.')}</small>
          </div>
        )}
        {payload.state === 'found' && <FoundItem item={payload} />}
      </section>
    </div>
  )
}

function FoundItem({ item }: { item: ItemOverlayInfo }) {
  const trader = item.bestTrader
  const names = item.mateNames ?? []
  return <>
    <header className="map-item-card-head">
      {item.iconUrl && <span className={`map-item-card-icon${item.weaponPreset ? ' is-weapon' : ''}`}><img src={item.iconUrl} alt="" title={item.weaponPreset ? uiText('Стандартная сборка: обвесы и цвет могут отличаться') : undefined} /></span>}
      <strong className="map-item-card-name" title={uiText(item.name)}>{uiText(item.name)}</strong>
    </header>
    <dl className="map-item-card-prices">
      <div><dt>{uiText('Барахолка')}{item.fleaAverage ? <small> · {uiText('средняя за 24 ч')}</small> : null}</dt><dd>{item.fleaPrice ? rub(item.fleaPrice) : '—'}</dd></div>
      <div><dt>{trader ? uiText(trader.name) : uiText('Торговец')}</dt><dd>{trader ? rub(trader.price) : '—'}</dd></div>
    </dl>
    {(item.collector || item.mate) && (
      <div className="map-item-card-tags">
        {item.collector && <span className="map-item-card-tag is-kappa">{uiText('Каппа')}</span>}
        {item.mate && <span className="map-item-card-tag is-mate" title={names.length ? names.join(', ') : undefined}>{names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : uiText('Друг')}</span>}
      </div>
    )}
  </>
}
