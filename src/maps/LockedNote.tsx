import { Lock } from 'lucide-react'
import type { Item } from '../domain/types'
import type { LockedRoom } from '../data/mapRoomSigns'
import { uiText } from '../i18n/renderText'

/**
 * A point with the small padlock (a room behind a locked door): which door and which key (owner, 10.11.2026: «в описании пишется что
 * находится за дверью такой то и какой ключ нужен»). The door is named by its key; the Lab's rooms by their own name.
 */
export function LockedNote({ rooms, items }: { rooms: readonly LockedRoom[]; items: ReadonlyMap<string, Pick<Item, 'name' | 'iconUrl'>> }) {
  const keys = [...new Map(rooms.flatMap((room) => {
    const name = (room.keyId ? items.get(room.keyId)?.name : undefined) ?? room.keyName
    return name ? [[name, { name, iconUrl: room.keyId ? items.get(room.keyId)?.iconUrl : undefined, room: room.room }] as const] : []
  })).values()]
  if (!keys.length) return <p className="map-locked-note"><Lock size={12} aria-hidden="true" />{uiText('За запертой дверью')}</p>
  return (
    <div className="map-locked-note">
      <Lock size={12} aria-hidden="true" />
      <span>
        {uiText('За запертой дверью')}{keys[0]!.room ? <>: {uiText(keys[0]!.room)}</> : null}
        {keys.map((key) => (
          <span key={key.name} className="map-locked-key">
            {key.iconUrl && <img src={key.iconUrl} alt="" loading="lazy" decoding="async" />}
            <span>{uiText('Нужен ключ')}: <strong>{uiText(key.name)}</strong></span>
          </span>
        ))}
      </span>
    </div>
  )
}
