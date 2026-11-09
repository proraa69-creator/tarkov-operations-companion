import { useState } from 'react'
import type { Item } from '../domain/types'
import { uiText } from '../i18n/renderText'

/**
 * The keys a key spot may hold, as pictures with short names (owner, 09.11.2026: «показывай картинки всех ключей, которые там
 * спавнятся. Если очень большой список, сложи его, покажи 6 вариантов ключей, и добавь кнопку «Показать все»»). Dearest first;
 * with «Нужные ключи» on, only the needed ones. `compact`: the hover card — six and «+N», no button.
 */
const FOLDED = 6

export function KeySpotKeys({ keyIds, items, owned, compact = false }: {
  keyIds: readonly string[]
  items: ReadonlyMap<string, Item>
  owned?: { has(id: string): boolean }
  compact?: boolean
}) {
  const [all, setAll] = useState(false)
  if (!keyIds.length) return null
  const shown = all ? keyIds : keyIds.slice(0, FOLDED)
  const more = keyIds.length - shown.length
  return (
    <div className={`key-spot-keys${compact ? ' is-compact' : ''}`}>
      <ul>
        {shown.map((id) => {
          const item = items.get(id)
          return (
            <li key={id} className={owned?.has(id) ? 'is-owned' : ''} title={uiText(item?.name ?? id)}>
              {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="key-spot-keys-blank" aria-hidden="true" />}
              <span>{uiText(item?.shortName ?? item?.name ?? id)}</span>
            </li>
          )
        })}
      </ul>
      {more > 0 && (compact
        ? <small className="key-spot-keys-more">+{more}</small>
        : <button type="button" className="button small ghost key-spot-keys-all" onClick={() => setAll(true)}>{uiText('Показать все')} · {keyIds.length}</button>)}
    </div>
  )
}
