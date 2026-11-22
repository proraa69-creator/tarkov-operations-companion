import { useMemo, useState } from 'react'
import { Box } from 'lucide-react'
import type { GameMap, Item, MapMarker, RaidMode } from '../domain/types'
import { keyRoomLoot } from '../data/keyRoomLoot'
import { displayPrice } from '../domain/itemPrices'
import { uiText } from '../i18n/renderText'
import './keyRoomLoot.css'

/** How many items show before «Ещё»: two rows of the card. */
const FIRST = 12

/**
 * «Что в комнате» on a key's card (owner, 18.11.2026): what may spawn in the rooms its doors lock — the items, the dearest
 * first, and the containers. Nothing when no room of its doors is known.
 */
export function KeyRoomLoot({ keyId, markers, maps, items, mode }: { keyId: string; markers: readonly MapMarker[]; maps: readonly GameMap[]; items: readonly Item[]; mode: RaidMode }) {
  const [all, setAll] = useState(false)
  const loot = useMemo(() => keyRoomLoot(keyId, markers, maps), [keyId, markers, maps])
  const rows = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]))
    const price = (item: Item) => displayPrice(item, mode)?.price ?? 0
    return loot.items.flatMap(({ itemId }) => {
      const item = byId.get(itemId)
      return item ? [item] : []
    }).sort((a, b) => price(b) - price(a) || a.name.localeCompare(b.name, 'ru'))
  }, [loot.items, items, mode])
  if (!loot.known) return null
  const shown = all ? rows : rows.slice(0, FIRST)
  return <div className="detail-section key-room-loot">
    <h4>{uiText('Что в комнате')}</h4>
    {!rows.length && !loot.containers.length && <p className="key-room-loot-empty">{uiText('В комнате ничего не отмечено')}</p>}
    {loot.containers.length > 0 && <div className="key-room-loot-boxes">
      {loot.containers.map((box) => <span key={box.name} className="key-room-loot-box"><Box size={12} aria-hidden="true" />{uiText(box.name)}{box.count > 1 && <b>×{box.count}</b>}</span>)}
    </div>}
    {rows.length > 0 && <ul className="key-room-loot-items">
      {shown.map((item) => <li key={item.id} title={uiText(item.name)}>
        <span className="key-room-loot-picture">{item.iconUrl && <img src={item.iconUrl} alt="" loading="lazy" decoding="async" />}</span>
        <span className="key-room-loot-name">{uiText(item.shortName || item.name)}</span>
      </li>)}
    </ul>}
    {rows.length > FIRST && <button type="button" className="key-room-loot-more" onClick={() => setAll(!all)}>
      {all ? uiText('Скрыть') : `${uiText('Ещё')} ${rows.length - FIRST}`}
    </button>}
  </div>
}
