import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Check, Package } from 'lucide-react'
import type { Item, Quest, QuestOfferUnlock, Trader } from '../domain/types'
import { questPageHref, traderLevelText, UNLOCK_KINDS, unlockKind, useItemQuestUnlocks, type UnlockKind } from './questOfferUnlockIndex'
import { useTarkovData } from '../data/DataProvider'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { TraderBadge } from '../gunsmith/TraderBadge'
import './questOfferUnlocks.css'

/**
 * What a quest opens at the traders, in its «Награды», and after which quest an item goes on sale, in the item's card
 * (owner, 16.11.2026, report 171). The rows come with the catalog of the mode on screen (src/data/questOfferUnlocks.ts),
 * so PvP, PvE and Season never mix.
 */

const KIND_TITLE: Record<UnlockKind, { ru: string; en: string }> = {
  mods: { ru: 'Модули', en: 'Parts' },
  ammo: { ru: 'Патроны', en: 'Ammo' },
  items: { ru: 'Предметы', en: 'Items' },
}

function useLookups() {
  const { data } = useTarkovData()
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const traders = useMemo(() => new Map((data.traders ?? []).map((trader) => [trader.id, trader])), [data.traders])
  return { items, traders }
}

/** «Открывает у торговцев» inside a quest's «Награды»: parts, ammo and other items, each opening its card on «Барахолка». */
export function QuestOfferUnlocks({ quest }: { quest: Quest }) {
  const { locale } = useLocale()
  const { items, traders } = useLookups()
  const rows = quest.offerUnlocks ?? []
  if (!rows.length) return null
  const groups = UNLOCK_KINDS.map((kind) => ({ kind, rows: rows.filter((row) => unlockKind(items.get(row.itemId)) === kind) })).filter((group) => group.rows.length)
  return <div className="quest-unlocks" data-testid="quest-offer-unlocks">
    <p className="quest-unlocks-title">{locale === 'en' ? 'Unlocks at traders' : 'Открывает у торговцев'}</p>
    {groups.map((group) => <div className="quest-unlocks-group" key={group.kind}>
      {groups.length > 1 && <small className="quest-unlocks-kind">{KIND_TITLE[group.kind][locale === 'en' ? 'en' : 'ru']}</small>}
      <ul>
        {group.rows.map((row) => <UnlockRow key={`${row.itemId}-${row.traderId}`} row={row} item={items.get(row.itemId)} trader={traders.get(row.traderId)} locale={locale} />)}
      </ul>
    </div>)}
  </div>
}

function UnlockRow({ row, item, trader, locale }: { row: QuestOfferUnlock; item?: Item; trader?: Trader; locale: AppLocale }) {
  const name = uiText(trader?.name ?? '')
  return <li>
    <Link to={`/flea?selected=${encodeURIComponent(row.itemId)}`} className="quest-unlock" title={uiText(item?.name ?? row.itemId)}>
      {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="quest-unlock-empty"><Package size={16} /></span>}
      <span className="quest-unlock-copy">
        <strong>{uiText(item?.shortName ?? item?.name ?? row.itemId)}</strong>
        <small>{uiText(item?.name ?? '')}</small>
      </span>
      {trader && <span className="quest-unlock-trader">
        <TraderBadge trader={trader} name={name} level={row.level} barter={row.barter} small />
        <small>{traderLevelText(name, row.level, row.barter, locale)}</small>
      </span>}
    </Link>
  </li>
}

/**
 * «Открывается после квеста» in an item's card: each quest that puts the item on sale, with the trader and level; the
 * quest's name opens it in «Квесты». Nothing for an item a trader sells by loyalty alone.
 */
export function ItemQuestUnlocks({ itemId, onOpenQuest }: { itemId: string; onOpenQuest?: () => void }) {
  const { locale } = useLocale()
  const { traders } = useLookups()
  const index = useItemQuestUnlocks()
  const state = useAppState()
  const progress = state.activeProfile.modes[state.raidMode]
  const rows = index.get(itemId) ?? []
  if (!rows.length) return null
  return <div className="detail-section item-quest-unlocks" data-testid="item-quest-unlocks">
    <h4>{locale === 'en' ? (rows.length > 1 ? 'Unlocked by quests' : 'Unlocked by a quest') : (rows.length > 1 ? 'Открывается после квестов' : 'Открывается после квеста')}</h4>
    <ul>
      {rows.map((row) => {
        const trader = traders.get(row.traderId)
        const name = uiText(trader?.name ?? '')
        const done = progress.taskProgress[row.quest.id]?.status === 'completed'
        return <li key={`${row.quest.id}-${row.traderId}`}>
          {trader && <TraderBadge trader={trader} name={name} level={row.level} barter={row.barter} small />}
          <span>
            <Link to={questPageHref(row.quest.id)} className="item-quest-link" onClick={onOpenQuest}>«{uiText(row.quest.name)}»</Link>
            <small className="dim">{trader ? traderLevelText(name, row.level, row.barter, locale) : ''}</small>
          </span>
          {done && <span className="tag green item-quest-done"><Check size={11} />{locale === 'en' ? 'done' : 'выполнен'}</span>}
        </li>
      })}
    </ul>
  </div>
}
