import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { closeRecognisedItem, useRecognisedItem } from '../items/recognisedItem'
import type { ItemOverlayInfo } from '../overlay/types'
import '../styles/mapItemCard.css'

const rub = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`
/** Quests listed on the card; the rest as «+N». */
const QUESTS_SHOWN = 3

/**
 * The recognised item on «Карты» (owner, 15.10.2026: «Информация о предмете будет появляться слева наверху на карте, под
 * кнопкой вид»): picture and name, the flea and best trader price, which quests and whose quests still need it, and its
 * Kappa status. Mounted as the last part of the map's HUD row, on a line of its own: under «Вид», never over the map
 * controls (their menus open over it). Stays until the next item or «Закрыть». The same on the phone, from the PC of the
 * account (items/recognisedItem.ts).
 */
export function MapItemCard() {
  const item = useRecognisedItem()
  const ref = useRef<HTMLDivElement>(null)
  const [indent, setIndent] = useState(0)
  // Level with «Вид» (the map's name is left of it on the PC).
  useLayoutEffect(() => {
    const node = ref.current
    const toggle = node?.closest('.map-hud')?.querySelector<HTMLElement>('.map-view-toggle')
    if (!node || !toggle) return
    // Both sit in the HUD (positioned): the toggle's offset is the card's indent.
    const measure = () => setIndent(Math.max(0, toggle.offsetLeft))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(toggle.parentElement ?? toggle)
    return () => observer?.disconnect()
  }, [item])
  if (!item) return null
  const { payload } = item
  return (
    <div ref={ref} className="map-item-card-row" style={{ paddingLeft: indent }}>
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
  const quests = item.quests
  const more = quests.length - QUESTS_SHOWN
  const needed = quests.length > 0 || item.collector
  return <>
    <header className="map-item-card-head">
      {item.iconUrl && <span className={`map-item-card-icon${item.weaponPreset ? ' is-weapon' : ''}`}><img src={item.iconUrl} alt="" title={item.weaponPreset ? uiText('Стандартная сборка: обвесы и цвет могут отличаться') : undefined} /></span>}
      <strong className="map-item-card-name" title={uiText(item.name)}>{uiText(item.name)}</strong>
    </header>
    <dl className="map-item-card-prices">
      <div><dt>{uiText('Барахолка')}{item.fleaAverage ? <small> · {uiText('средняя за 24 ч')}</small> : null}</dt><dd>{item.fleaPrice ? rub(item.fleaPrice) : '—'}</dd></div>
      <div><dt>{trader ? uiText(trader.name) : uiText('Торговец')}</dt><dd>{trader ? rub(trader.price) : '—'}</dd></div>
    </dl>
    <div className="map-item-card-needs">
      <div className="map-item-card-tags">
        <span className={`map-item-card-tag${item.collector ? ' is-kappa' : ''}`}>{uiText(item.collector ? 'Каппа: нужен для «Коллекционера»' : item.kappa ? 'Каппа: нужен для заданий на Каппу' : 'Каппа: не нужен')}</span>
        {item.mate && <span className="map-item-card-tag is-mate" title={uiText(item.mateNames?.length ? `Нужен: ${item.mateNames.join(', ')}` : 'Нужен другу или участнику отряда')}>{item.mateNames?.length ? `${uiText('Нужен:')} ${item.mateNames.slice(0, 3).join(', ')}${item.mateNames.length > 3 ? ` +${item.mateNames.length - 3}` : ''}` : uiText('Нужен другу')}</span>}
      </div>
      {quests.length > 0 && (
        <ul className="map-item-card-quests" aria-label={uiText('Нужен для квестов')}>
          {quests.slice(0, QUESTS_SHOWN).map((quest) => (
            <li key={quest.questId || quest.name}>
              <span>{uiText(quest.name)}{quest.kappa ? <em className="map-item-card-k" title={uiText('Квест нужен для Каппы')}>K</em> : null}</span>
              <small>{uiText(quest.purpose)} ×{quest.count}</small>
            </li>
          ))}
          {more > 0 && <li className="is-more"><small>+{more}</small></li>}
        </ul>
      )}
      {!needed && !item.mate && <small className="map-item-card-free">{uiText('Не нужен для ваших текущих квестов и Каппы.')}</small>}
    </div>
  </>
}
