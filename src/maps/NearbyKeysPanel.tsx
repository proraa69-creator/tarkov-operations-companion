import { useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, KeyRound, X } from 'lucide-react'
import type { Item } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { setNearbyKeysOn, useNearbyKeysOn, type NearbyKey } from './nearbyKeys'
import { setNeededSpawnsOnly, useNeededSpawnsOnly } from './neededSpawns'
import './nearbyKeys.css'

/**
 * «Ключи рядом» in a raid (src/maps/nearbyKeys.ts), at the bottom left of the map where a quest's window opens, wide and low
 * (owner, 19.11.2026): the keys only, each opening its card over the list. While the list is open their spawns glow as a
 * chosen quest's points do (MapsPage); «Свернуть» takes the glow off and leaves the spawns on the map until the raid ends,
 * «Закрыть» ends it for the raid.
 */
export function NearbyKeysPanel({ keys, items, folded, onFold, onClose, keyCard }: {
  keys: readonly NearbyKey[]
  items: ReadonlyMap<string, Item>
  folded: boolean
  onFold: (folded: boolean) => void
  onClose: () => void
  /** The key's card as a key spot shows it (price, barters, tier, quests). */
  keyCard: (keyId: string) => ReactNode
}) {
  const [picked, setPicked] = useState<string | null>(null)
  if (!keys.length) return null
  if (folded) {
    return <button type="button" className="nearby-keys-chip" onClick={() => onFold(false)}>
      <KeyRound size={14} aria-hidden="true" />{uiText('Ключи рядом')} · {keys.length}<ChevronUp size={14} aria-hidden="true" />
    </button>
  }
  const shown = picked && keys.some((entry) => entry.keyId === picked) ? picked : null
  return <section className="nearby-keys" role="status" aria-live="polite" aria-label={uiText('Ключи рядом')}>
    <header>
      <KeyRound size={15} aria-hidden="true" />
      <strong>{uiText('Рядом с вашим квестом спавн ключа — проверьте')}</strong>
      <button type="button" className="icon-button" onClick={() => { setPicked(null); onFold(true) }} aria-label={uiText('Свернуть')} title={uiText('Свернуть')}><ChevronDown size={15} /></button>
      <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={15} /></button>
    </header>
    <ul>
      {keys.map((entry) => {
        const item = items.get(entry.keyId)
        return <li key={entry.keyId}>
          <button type="button" onClick={() => setPicked(entry.keyId)} title={uiText(item?.name ?? entry.keyId)}>
            <span className="nearby-keys-picture">{item?.iconUrl ? <img src={item.iconUrl} alt="" /> : <KeyRound size={16} />}</span>
            <span className="nearby-keys-text">
              <strong>{uiText(item?.shortName || item?.name || entry.keyId)}</strong>
              <small>{entry.quests.map((quest) => uiText(quest.name)).join(', ')}</small>
            </span>
          </button>
        </li>
      })}
    </ul>
    {shown && <div className="nearby-keys-card">
      <header>
        <button type="button" className="icon-button" onClick={() => setPicked(null)} aria-label={uiText('Назад')} title={uiText('Назад')}><ArrowLeft size={15} /></button>
        <strong>{uiText(items.get(shown)?.name ?? shown)}</strong>
        <button type="button" className="icon-button" onClick={() => setPicked(null)} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={15} /></button>
      </header>
      <div className="nearby-keys-card-body">{keyCard(shown)}</div>
    </div>}
  </section>
}

/** «Настройки карты»: the switch of «Ключи рядом». */
export function NearbyKeysSetting() {
  const on = useNearbyKeysOn()
  const title = uiText('Показывать уведомления о ближайших ключах')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{uiText('Ключи рядом')}</div>
    <div className="skill-timer-row">
      <span>{title}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={title} className={`toggle ${on ? 'on' : ''}`} onClick={() => setNearbyKeysOn(!on)}><span /></button>
    </div>
  </div>
}

/** «Настройки карты»: «Показывать только нужные спавны» (maps/neededSpawns.ts). */
export function NeededSpawnsSetting() {
  const on = useNeededSpawnsOnly()
  const title = uiText('Показывать только нужные спавны')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{uiText('Спавны')}</div>
    <div className="skill-timer-row">
      <span>{title}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={title} className={`toggle ${on ? 'on' : ''}`} onClick={() => setNeededSpawnsOnly(!on)}><span /></button>
    </div>
  </div>
}
