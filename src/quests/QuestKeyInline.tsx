import { Check, Package, Star } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { ItemBuySection } from '../components/ItemBuySection'
import { keyTiers } from '../keys/locationKeysList'
import { formatPrice } from '../shared/format'
import { setOwnedKey, useOwnedKeys } from './ownedKeys'
import { setQuestKeyFavorite, useQuestKeyFavorites } from './questKeyFavorites'
import './questKeys.css'

/**
 * A key of «Требуемые предметы» in the quest window, open right under it (owner, 19.11.2026: «по нажатию ключ от комнаты 114…
 * сразу в этом окне показывается цена, с какого уровня открывается барахолка, и сразу развернутый бартер… у кого бартер, какие
 * предметы нужны, открыты эти предметы»): no window of its own. Whether the player has it (and «Добавить в наличие»), its tier
 * letter and price, the star of «Избранные ключи», then every way to buy it, the barters open with their items.
 */
export function QuestKeyInline({ itemId }: { itemId: string }) {
  const { data } = useTarkovData()
  const state = useAppState()
  const mode = state.raidMode
  const profileId = state.activeProfile.id
  const owned = useOwnedKeys(profileId, mode)
  const favorites = useQuestKeyFavorites(profileId, mode)
  const item = data.items.find((entry) => entry.id === itemId)
  if (!item) return null
  const has = owned.has(item.id)
  const starred = favorites.has(item.id)
  const worth = keyTiers(data.items, mode).get(item.id)
  const starLabel = uiText(starred ? 'Убрать из избранных ключей' : 'В избранные ключи')
  return <div className="quest-key-inline">
    <div className="quest-key-inline-head">
      {worth && <b className={`location-key-tier tier-${worth.tier.toLowerCase()} quest-key-inline-tier`} title={`${uiText('Тир-лист')}: ${worth.tier}`}>{worth.tier}</b>}
      <span className={`tag ${has ? 'green' : ''}`}>{uiText(has ? 'Есть в наличии' : 'Нет в наличии')}</span>
      {worth && <strong className="mono">{formatPrice(worth.price)}</strong>}
      <span className="quest-key-inline-actions">
        <button type="button" className="icon-button" aria-pressed={has} title={uiText(has ? 'Убрать из наличия' : 'Добавить в наличие')} aria-label={uiText(has ? 'Убрать из наличия' : 'Добавить в наличие')}
          onClick={() => setOwnedKey(profileId, mode, item.id, has ? 0 : 1)}>{has ? <Check size={14} /> : <Package size={14} />}</button>
        <button type="button" className={`icon-button${starred ? ' is-on' : ''}`} aria-pressed={starred} title={starLabel} aria-label={starLabel}
          onClick={() => setQuestKeyFavorite(profileId, mode, item.id, !starred)}><Star size={14} fill={starred ? 'currentColor' : 'none'} /></button>
      </span>
    </div>
    <ItemBuySection itemId={item.id} />
  </div>
}
