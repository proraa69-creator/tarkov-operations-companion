import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, KeyRound, Package, Star, X } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import type { Barter } from '../data/economyApi'
import { useLivePrices, withLivePrice } from '../data/livePrices'
import { useEconomySnapshot } from '../data/useEconomy'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { QuestKeyBarterDialog, QuestKeyMarket } from './QuestKeyMarket'
import { setOwnedKey, useOwnedKeys } from './ownedKeys'
import { setQuestKeyFavorite, useQuestKeyFavorites } from './questKeyFavorites'
import './questKeys.css'

/**
 * One key as «Ключи для квестов» shows it, in a window over the map (owner, 11.11.2026: «В требуемых предметах при нажатии ключ от
 * времянки… открывается окно с этим ключом. Пишется «нет в наличии», бартер показывается, добавить в избранное, и кнопка «добавить
 * в наличие»… будет писаться» есть в наличии): its picture and name, whether the player has it, its price and barters, the star of
 * «Избранные ключи», and «Добавить в наличие» / «Убрать из наличия» (quests/ownedKeys.ts, the same list as «Ключи в схроне»).
 */
export function QuestKeyDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { data } = useTarkovData()
  const state = useAppState()
  const mode = state.raidMode
  const profileId = state.activeProfile.id
  const item = data.items.find((entry) => entry.id === itemId)
  const owned = useOwnedKeys(profileId, mode)
  const favorites = useQuestKeyFavorites(profileId, mode)
  const live = useLivePrices(mode)
  const economy = useEconomySnapshot(mode).data
  const loyalty = useTraderLoyalty()
  const [barterOpen, setBarterOpen] = useState(false)
  const closeBarter = () => setBarterOpen(false)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !barterOpen) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, barterOpen])
  const barters = useMemo(() => (economy?.barters ?? []).filter((barter: Barter) => barter.rewardItems.some((reward) => reward.itemId === itemId)), [economy, itemId])
  if (!item) return null
  const has = owned.has(item.id)
  const starred = favorites.has(item.id)
  const starLabel = uiText(starred ? 'Убрать из избранных ключей' : 'В избранные ключи')
  const partOf = (id: string, count: number) => {
    const known = data.items.find((entry) => entry.id === id)
    const traded = economy?.items[id]
    return { id, name: known?.name ?? traded?.name ?? id, iconUrl: known?.iconUrl ?? traded?.iconUrl, count }
  }
  const traderOf = (traderId: string) => data.traders.find((trader) => trader.id === traderId)
  return createPortal(
    <>
      <div className="registration-overlay quest-key-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section className="panel registration-dialog quest-key-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button ref={closeRef} type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
          <div className="quest-key-head">
            <span className="quest-key-picture">{item.iconUrl ? <img src={item.iconUrl} alt="" /> : <KeyRound size={22} aria-hidden="true" />}</span>
            <div className="quest-key-title"><strong id={titleId}>{uiText(item.name)}</strong></div>
          </div>
          <div className="quest-key-dialog-row">
            {has
              ? <span className="tag green quest-key-owned">{uiText('Есть в наличии')}</span>
              : <span className="tag quest-key-missing">{uiText('Нет в наличии')}</span>}
            <QuestKeyMarket item={withLivePrice(item, mode, live)} mode={mode} barters={barters} onBarter={() => setBarterOpen(true)} />
          </div>
          <div className="quest-key-dialog-actions">
            <button type="button" className={`button${has ? '' : ' primary'}`} aria-pressed={has} onClick={() => setOwnedKey(profileId, mode, item.id, has ? 0 : 1)}>
              {has ? <Check size={15} aria-hidden="true" /> : <Package size={15} aria-hidden="true" />}{uiText(has ? 'Убрать из наличия' : 'Добавить в наличие')}
            </button>
            <button type="button" className={`button quest-key-dialog-star${starred ? ' is-on' : ''}`} aria-pressed={starred} aria-label={starLabel} title={starLabel} onClick={() => setQuestKeyFavorite(profileId, mode, item.id, !starred)}>
              <Star size={15} fill={starred ? 'currentColor' : 'none'} aria-hidden="true" />{uiText(starred ? 'В избранном' : 'Добавить в избранное')}
            </button>
          </div>
        </section>
      </div>
      {barterOpen && <QuestKeyBarterDialog item={item} barters={barters} partOf={partOf} traderOf={traderOf} loyalty={loyalty} onClose={closeBarter} />}
    </>,
    document.body,
  )
}
