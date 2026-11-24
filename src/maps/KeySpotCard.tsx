import { useMemo } from 'react'
import { Star } from 'lucide-react'
import type { Item, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { ItemBuySection } from '../components/ItemBuySection'
import { keyTiers } from '../keys/locationKeysList'
import type { QuestKeyRow } from '../quests/questKeys'
import { formatPrice } from '../shared/format'
import './keySpotCard.css'

/**
 * A key of a key spot on the map (owner, 19.11.2026: «по нажатию на ключ, который спавнится на карте, в этой карточке должна быть
 * информация… с какого уровня продается на барахолке, потом бартер, по каким предметам и какая цена, потом тир-лист этого ключа…
 * кнопочка возле крестика добавить в избранное… для каких квестов нужен этот ключ. И есть ли он в наличии»). Small: the key with its
 * tier letter and whether the player has it, the ways to buy it (ItemBuySection: traders, the flea from its level, barters with
 * their items and price) and the quests that need it. The star beside the card's cross puts it in «Избранные ключи».
 */
export function KeySpotCard({ item, items, mode, owned, questRow, favorite, onFavorite, showName = false }: {
  item: Item
  showName?: boolean
  items: readonly Item[]
  mode: RaidMode
  owned: number
  questRow?: QuestKeyRow
  favorite: boolean
  onFavorite: () => void
}) {
  const worth = useMemo(() => keyTiers(items, mode).get(item.id), [items, mode, item.id])
  const quests = [...(questRow?.needed ?? []), ...(questRow?.deferred ?? [])]
  return <div className="key-spot-card">
    <button type="button" className={`icon-button key-spot-card-favorite${favorite ? ' is-on' : ''}`} onClick={onFavorite}
      aria-pressed={favorite} aria-label={uiText(favorite ? 'Убрать из избранных ключей' : 'В избранные ключи')} title={uiText(favorite ? 'Убрать из избранных ключей' : 'В избранные ключи')}>
      <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
    </button>
    <div className="key-spot-card-head">
      <span className="key-spot-card-picture">
        {item.iconUrl && <img src={item.iconUrl} alt="" />}
        {worth && <b className={`location-key-tier tier-${worth.tier.toLowerCase()}`} title={`${uiText('Тир-лист')}: ${worth.tier}`}>{worth.tier}</b>}
      </span>
      <span className="key-spot-card-name">
        {/* the name stands in the card's title; under a spot of several keys, the one picked */}
        {showName && <strong>{uiText(item.name)}</strong>}
        <span className="key-spot-card-tags">
          <span className={`key-spot-card-stock${owned > 0 ? ' is-owned' : ''}`}>{owned > 0 ? `${uiText('Есть в схроне')}${owned > 1 ? ` · ${owned}` : ''}` : uiText('Нет в наличии')}</span>
          {worth && <span className="key-spot-card-price">{formatPrice(worth.price)}</span>}
        </span>
      </span>
    </div>
    <ItemBuySection itemId={item.id} />
    <div className="detail-section key-spot-card-quests">
      <h4>{uiText('Нужен для квестов')}</h4>
      {quests.length
        ? <ul>{quests.map((use) => <li key={use.quest.id} className={use.entry ? 'is-deferred' : undefined}>{uiText(use.quest.name)}{use.entry ? <small> · {uiText('Отложен')}</small> : null}</li>)}</ul>
        : <p className="dim">{uiText('Для текущих квестов не нужен')}</p>}
    </div>
  </div>
}
