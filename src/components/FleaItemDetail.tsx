import { useMemo, type Ref } from 'react'
import { Heart, ShoppingCart, Star, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { ageText, formatPrice } from '../shared/format'
import { PriceHistoryChart } from './PriceHistoryChart'
import { bestSale, fleaRenewedAt, fleaSale, isAveragePrice, modeQuotes, quoteKind } from '../domain/itemPrices'
import type { Item, PriceQuote } from '../domain/types'
import { buildKeyDoorIndex, isKeyItem } from '../data/keyDoors'
import { KeyDoorsButton } from './KeyDoorsButton'
import { useLivePrices, withLivePrice } from '../data/livePrices'
import { useMinuteClock } from '../trading/tradingClock'
import { useLocale } from '../i18n/LocaleProvider'
import { ItemQuestUnlocks } from '../quests/QuestOfferUnlocks'
import { ItemBuySection } from './ItemBuySection'
import { KeyRoomLoot } from './KeyRoomLoot'

/**
 * An item's card as «Барахолка» shows it on the right (src/pages/FleaMarketPage.tsx): picture, description, the prices of
 * the mode on screen with their age, the quests that put it on sale, the price history and the favourites/raid buttons.
 * «Оружейник» opens the same card for a part (owner, 16.11.2026, report 171). `item` is the catalog's; the minute
 * prices are laid over it here.
 */
export function FleaItemDetail({ item: catalogItem, onClose, panelRef, className = '', noPrices = false }: {
  item: Item
  onClose: () => void
  /** No «Цены» table (the keys window, owner 18.11.2026: «цены, сезон, барахолка, терапевт… лучше это не пиши вообще. Нам нужно только в бартер»). */
  noPrices?: boolean
  panelRef?: Ref<HTMLElement>
  className?: string
}) {
  const { data } = useTarkovData()
  const state = useAppState()
  const { locale } = useLocale()
  const live = useLivePrices(state.raidMode)
  const clock = useMinuteClock()
  const selected = useMemo(() => withLivePrice(catalogItem, state.raidMode, live), [catalogItem, live, state.raidMode])
  const priceAge = (at: number | undefined) => at === undefined ? null : ageText(clock - at, locale)
  // When this lowest offer came — nothing for a price the minute file gives no time of its own (never «только что» by default).
  const minute = live?.items.get(selected.id)
  const selectedRenewedAt = minute && !(minute.at && minute.at > 0) ? undefined : fleaRenewedAt(selected, state.raidMode)
  const keyDoors = useMemo(() => isKeyItem(catalogItem) ? buildKeyDoorIndex(data.markers, data.maps) : undefined, [catalogItem, data.markers, data.maps])
  // The flea of the selected mode only (its fee rates): the catalog is loaded per mode.
  const fleaMarket = data.metadata?.mode === state.raidMode ? data.metadata.fleaMarket : undefined
  const feeOptions = { offerFeeRate: fleaMarket?.offerFeeRate, requirementFeeRate: fleaMarket?.requirementFeeRate }
  const selectedQuotes = modeQuotes(selected, state.raidMode).sort((a, b) => Number(quoteKind(b) === 'flea') - Number(quoteKind(a) === 'flea') || b.price - a.price)
  const selectedFlea = fleaSale(selected, state.raidMode, feeOptions)
  const selectedBest = bestSale(selected, state.raidMode, feeOptions)
  const isBest = (quote: PriceQuote) => Boolean(selectedBest && quoteKind(quote) === selectedBest.kind && quote.source === selectedBest.source && quote.price === selectedBest.price)
  const favorite = state.favoriteItemIds.includes(selected.id)

  return <aside ref={panelRef} className={`panel detail-panel flea-detail ${className}`.trim()}>
    <button className="registration-close" onClick={onClose} aria-label={uiText("Закрыть карточку")}><X size={16} /></button>
    <div className="item-detail-visual"><img src={selected.iconUrl} alt={uiText(selected.name)} /></div>
    <div className="detail-hero"><div className="eyebrow">{uiText(selected.category)} · {uiText(selected.shortName)}</div><h2 style={{ margin: '10px 0 7px', fontSize: 'calc(24px * var(--font-scale, 1))' }}>{uiText(selected.name)}</h2><div className="filter-row" style={{ margin: 0 }}>{uiText(selected.slots && <span className="tag">{uiText(selected.slots)}</span>)}{uiText(selected.weight && <span className="tag">{uiText(selected.weight)}{uiText(" кг")}</span>)}{uiText(selected.caliber && <span className="tag brass">{uiText(selected.caliber)}</span>)}</div></div>
    <div className="detail-section"><h4>{uiText("Описание")}</h4><p>{uiText(selected.description)}</p></div>
    {uiText((selected.damage || selected.penetration) && <div className="detail-section grid-2"><div><div className="stat-label">{uiText("Урон")}</div><div className="stat-value">{uiText(selected.damage)}</div></div><div><div className="stat-label">{uiText("Пробитие")}</div><div className="stat-value">{uiText(selected.penetration)}</div></div></div>)}
    <ItemQuestUnlocks itemId={selected.id} />
    {/* how to get it now: traders, the flea, barters at today's prices (report 187) */}
    <ItemBuySection itemId={selected.id} />
    {!noPrices && <div className="detail-section"><h4>{uiText("Цены · ")}{uiText(state.raidMode.toUpperCase())}</h4><table className="price-table"><thead><tr><th>{uiText("Источник")}</th><th>{uiText("Цена")}</th></tr></thead><tbody>{uiText(selectedQuotes.map((quote) => <tr key={`${quote.source}-${quote.price}`}><td>{uiText(quote.source)}{uiText(isBest(quote) && <span className="tag green" style={{ marginLeft: 7 }}>{uiText("лучшее")}</span>)}{quoteKind(quote) === 'flea' && <small className="dim" style={{ display: 'block' }}>{uiText(isAveragePrice(quote) ? 'среднее за 24 ч' : 'минимальное предложение')}{selectedRenewedAt !== undefined && ` · ${priceAge(selectedRenewedAt)}`}</small>}{quoteKind(quote) === 'base' && <small className="dim" style={{ display: 'block' }}>{uiText('не предложение')}</small>}</td><td className="mono">{uiText(formatPrice(quote.price))}{quoteKind(quote) === 'flea' && selectedFlea?.fee ? <small className="dim" style={{ display: 'block' }}>{uiText('после комиссии')} {formatPrice(selectedFlea.net)}</small> : null}</td></tr>))}{uiText(!selectedQuotes.length && <tr><td colSpan={2} className="muted">{uiText("Нет данных для выбранного режима.")}</td></tr>)}</tbody></table></div>}
    {keyDoors && <div className="detail-section key-doors-detail"><h4>{uiText('Дверь на карте')}</h4><KeyDoorsButton keyName={selected.name} doors={keyDoors.get(selected.id)} variant="detail" /></div>}
    {keyDoors && <KeyRoomLoot keyId={selected.id} markers={data.markers} maps={data.maps} items={data.items} mode={state.raidMode} />}
    {!noPrices && <PriceHistoryChart itemId={selected.id} mode={state.raidMode} />}
    <div className="detail-section stack"><button className={`button ${favorite ? 'primary' : ''}`} onClick={() => state.toggleFavoriteItem(selected.id)}>{uiText(favorite ? <Heart size={15} fill="currentColor" /> : <Star size={15} />)} {uiText(favorite ? 'Убрать из избранного' : 'Добавить в избранное')}</button><button className={`button ${state.raidItemIds.includes(selected.id) ? 'primary' : 'ghost'}`} onClick={() => state.toggleRaidItem(selected.id)}><ShoppingCart size={15} /> {uiText(state.raidItemIds.includes(selected.id) ? 'В списке рейда' : 'В список рейда')}</button></div>
  </aside>
}
