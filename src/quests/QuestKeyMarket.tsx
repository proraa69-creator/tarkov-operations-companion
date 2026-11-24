import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Repeat, X } from 'lucide-react'
import type { Barter } from '../data/economyApi'
import { fleaQuote, fleaRenewedAt } from '../domain/itemPrices'
import type { Item, RaidMode, Trader } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { formatPrice, timeAgo } from '../shared/format'

/**
 * «Ключи для квестов»: a key's flea price and its barters (owner, 07.11.2026: «слева от нее будет писаться цена, актуальная… цены
 * постоянно обновляются… С барахолки, и написано, когда последний раз обновлено… ниже под ней пишется бартер. По нажатию открывается
 * окно бартера. У какого торговца и на что можно менять данный ключ… с какого уровня лояльности открывается этот бартер»).
 */
export function QuestKeyMarket({ item, mode, barters, onBarter }: { item: Item; mode: RaidMode; barters: readonly Barter[]; onBarter: () => void }) {
  const quote = fleaQuote(item, mode)
  const renewed = fleaRenewedAt(item, mode)
  return <div className="quest-key-market">
    {quote
      ? <span className="quest-key-price" title={renewed ? new Date(renewed).toLocaleString() : undefined}>
        <strong>{formatPrice(Math.round(quote.price))}</strong>
        <small>{uiText('Барахолка')} · {uiText(timeAgo(renewed))}</small>
      </span>
      : <span className="quest-key-price is-none"><small>{uiText('Нет на барахолке')}</small></span>}
    {barters.length > 0 && <button type="button" className="button small ghost quest-key-barter" onClick={onBarter}>
      <Repeat size={13} aria-hidden="true" />{uiText('Бартер')}{barters.length > 1 ? ` · ${barters.length}` : ''}
    </button>}
  </div>
}

/** What a barter asks, as a list of items with their pictures. */
export interface BarterPart { id: string; name: string; iconUrl?: string; count: number }

/** The barters that give this key: the trader, the loyalty level that opens each, what to give for it. */
export function QuestKeyBarterDialog({ item, barters, partOf, traderOf, loyalty, onClose }: {
  item: Item
  barters: readonly Barter[]
  partOf: (itemId: string, count: number) => BarterPart
  traderOf: (traderId: string) => Trader | undefined
  /** The player's loyalty level per trader, when known. */
  loyalty: ReadonlyMap<string, number>
  onClose: () => void
}) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const sorted = [...barters].sort((a, b) => a.level - b.level || a.traderName.localeCompare(b.traderName))
  return createPortal(
    <div className="registration-overlay quest-key-barter-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog quest-key-barter-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeRef} type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2 id={titleId}>{uiText('Бартер')}</h2>
        <div className="quest-key-barter-key">
          {item.iconUrl && <img src={item.iconUrl} alt="" />}
          <strong>{uiText(item.name)}</strong>
        </div>
        <ul className="quest-key-barters">
          {sorted.map((barter) => {
            const trader = traderOf(barter.traderId)
            const own = loyalty.get(barter.traderId)
            const locked = own !== undefined && own < barter.level
            return <li key={barter.id} className={locked ? 'is-locked' : undefined}>
              <div className="quest-key-barter-trader">
                {trader?.imageUrl && <img src={trader.imageUrl} alt="" />}
                <span>
                  <strong>{uiText(barter.traderName)}</strong>
                  <small>{uiText('Уровень лояльности')} {barter.level}{locked ? <> · <Lock size={11} aria-hidden="true" /> {uiText('у вас')} {own}</> : null}</small>
                  {barter.taskUnlock && <small>{uiText('Откроется после квеста')} «{uiText(barter.taskUnlock.name)}»</small>}
                </span>
              </div>
              <div className="quest-key-barter-give">
                <small>{uiText('Отдать')}</small>
                <ul>
                  {barter.requiredItems.map(({ itemId, count }) => {
                    const part = partOf(itemId, count)
                    return <li key={itemId} title={uiText(part.name)}>
                      {part.iconUrl ? <img src={part.iconUrl} alt="" /> : null}
                      <span>{uiText(part.name)}</span>
                      <b>×{part.count}</b>
                    </li>
                  })}
                </ul>
              </div>
            </li>
          })}
        </ul>
      </section>
    </div>,
    document.body,
  )
}
