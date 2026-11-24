import { useMemo } from 'react'
import { Lock, Repeat, ShoppingBag, Store } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useEconomySnapshot } from '../data/useEconomy'
import { useGunsmithAccess } from '../gunsmith/useGunsmithAccess'
import { FLEA_PLAYER_LEVEL } from '../gunsmith/traderLevels'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'
import { itemBuyOptions, type BuyLock, type ItemBuyOptions, type PartFlea } from '../trading/itemBuyOptions'
import './itemBuy.css'

/** «доступно», or what is still missing: a loyalty level, a quest, the character's level for the flea. */
function LockNote({ lock }: { lock?: BuyLock }) {
  if (!lock) return <span className="item-buy-state is-open">{uiText('доступно')}</span>
  return <span className="item-buy-state is-locked">
    <Lock size={11} aria-hidden="true" />
    {lock.playerLevel !== undefined && <>{uiText('с уровня персонажа')} {lock.playerLevel}</>}
    {lock.level !== undefined && <>{uiText('нужен ур.')} {lock.level}</>}
    {lock.level !== undefined && lock.task && ' · '}
    {lock.task && <>{uiText('после квеста')} «{uiText(lock.task.name)}»</>}
  </span>
}

/** A barter part on the flea for this player: «доступно», the lock and the level it opens at, or «нет на барахолке». */
function PartFleaNote({ flea }: { flea: PartFlea }) {
  if (flea.state === 'open') return <em className="item-buy-part-flea is-open">{uiText('доступно')}</em>
  if (flea.state === 'none') return <em className="item-buy-part-flea is-none">{uiText('нет на барахолке')}</em>
  return <em className="item-buy-part-flea is-locked"><Lock size={10} aria-hidden="true" />{uiText('с ур.')} {flea.level}</em>
}

/**
 * «Купить» (report 187): the ways to get an item now in the mode on screen — traders' cash offers, the flea market, barters
 * with what they ask at today's prices — open ones first, each with what it still needs. Usable on its own (`itemId`):
 * the item's card shows it under the quests that open it.
 */
export function ItemBuySection({ itemId }: { itemId: string }) {
  const { data } = useTarkovData()
  const { access, infos, mode, playerLevel, fleaEnabled } = useGunsmithAccess()
  const economy = useEconomySnapshot(mode)
  const loyalty = useMemo(() => new Map(infos.map((info) => [info.trader.id, info.level])), [infos])
  const fleaLevel = data.metadata?.fleaMarket?.minPlayerLevel ?? FLEA_PLAYER_LEVEL
  const options: ItemBuyOptions | null = useMemo(() => economy.data
    ? itemBuyOptions(itemId, economy.data, { loyalty, playerLevel, fleaEnabled, fleaLevel, ...(access.taskDone ? { taskDone: access.taskDone } : {}) })
    : null, [access.taskDone, economy.data, fleaEnabled, fleaLevel, itemId, loyalty, playerLevel])
  const portrait = (traderId?: string) => data.traders.find((trader) => trader.id === traderId)?.imageUrl
  // a quest named by its id in the trading data: its name from the catalog
  const named = (lock?: BuyLock) => lock?.task ? { ...lock, task: { ...lock.task, name: data.quests.find((quest) => quest.id === lock.task!.id)?.name ?? lock.task.name } } : lock
  const nothing = options && !options.traders.length && !options.flea && !options.barters.length

  return <div className="detail-section item-buy">
    <h4>{uiText('Купить · ')}{uiText(mode === 'seasonal' ? 'Сезон' : mode.toUpperCase())}</h4>
    {!options && <p className="dim">{uiText(economy.isError ? 'Не удалось загрузить цены покупки.' : 'Загружаем цены…')}</p>}
    {nothing && <p className="dim">{uiText('Купить сейчас негде: только найти в рейде или получить за квест.')}</p>}
    {options && <ul className="item-buy-list">
      {options.traders.map((offer) => <li key={`${offer.traderName}-${offer.level}-${offer.price}`} className={offer.lock ? 'is-locked' : undefined}>
        <span className="item-buy-source">
          {portrait(offer.traderId) ? <img src={portrait(offer.traderId)} alt="" /> : <Store size={16} aria-hidden="true" />}
          <span><strong>{uiText(offer.traderName)} · {uiText('ур.')} {offer.level}</strong><LockNote lock={named(offer.lock)} /></span>
        </span>
        <span className="item-buy-price mono">{formatPrice(offer.price)}{offer.buyLimit ? <small>{uiText('лимит')} {offer.buyLimit}</small> : null}</span>
      </li>)}
      {options.flea && <li className={options.flea.lock ? 'is-locked' : undefined}>
        <span className="item-buy-source">
          <ShoppingBag size={16} aria-hidden="true" />
          <span><strong>{uiText('Барахолка')}</strong><LockNote lock={options.flea.lock} /></span>
        </span>
        <span className="item-buy-price mono">{formatPrice(options.flea.price)}{options.flea.average ? <small>{uiText('среднее за 24 ч')}</small> : null}</span>
      </li>}
      {/* the owner, 17.11.2026: «Если она недоступна на барахолке, так и пиши: недоступна на барахолке, есть бартер такой-то» */}
      {!options.flea && <li className="item-buy-note"><small>{uiText('Недоступно на барахолке')}</small></li>}
      {options.barters.map((barter) => <li key={barter.id} className={`item-buy-barter${barter.lock ? ' is-locked' : ''}`}>
        <span className="item-buy-source">
          {portrait(barter.traderId) ? <img src={portrait(barter.traderId)} alt="" /> : <Repeat size={16} aria-hidden="true" />}
          <span><strong>{uiText('Бартер')} · {uiText(barter.traderName)} · {uiText('ур.')} {barter.level}</strong><LockNote lock={named(barter.lock)} /></span>
        </span>
        <span className="item-buy-price mono">{barter.total !== null ? `≈ ${formatPrice(barter.total)}` : '—'}{barter.gives > 1 ? <small>{uiText('за')} {barter.gives} {uiText('шт.')}</small> : null}</span>
        <ul className="item-buy-parts">
          {barter.parts.map((part) => <li key={part.itemId} title={uiText(part.name)}>
            {part.iconUrl ? <img src={part.iconUrl} alt="" /> : null}
            <span>{uiText(part.name)}</span>
            <b>×{part.count}</b>
            <i className="mono">{part.total !== null ? formatPrice(part.total) : '—'}</i>
            <PartFleaNote flea={part.flea} />
          </li>)}
        </ul>
      </li>)}
    </ul>}
  </div>
}
