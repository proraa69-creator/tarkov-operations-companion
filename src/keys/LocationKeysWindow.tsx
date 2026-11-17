import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, GripHorizontal, KeyRound, MapPin, X } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { useOptionalTarkovData } from '../data/DataProvider'
import { buildKeyDoorIndex, keyDoorKindLabel, type KeyDoor } from '../data/keyDoors'
import { canonicalMapId } from '../data/mapIds'
import { ItemDrawer } from '../components/ItemDrawer'
import type { Item } from '../domain/types'
import { locationKeys, useLocationKeys } from './locationKeysStore'
import { clampKeysPosition, defaultKeysPosition, keyDoorsHref, keysOfLocation, locationsWithKeys } from './locationKeysList'
import './locationKeys.css'

const WINDOW_WIDTH = 440

/** «открывает 3 двери» / «opens 3 doors». */
function doorsCount(count: number, locale: AppLocale) {
  if (locale === 'en') return `opens ${count} ${count === 1 ? 'door' : 'doors'}`
  const tens = count % 100, ones = count % 10
  const word = tens > 10 && tens < 20 ? 'дверей' : ones === 1 ? 'дверь' : ones > 1 && ones < 5 ? 'двери' : 'дверей'
  return `открывает ${count} ${word}`
}

/** The place's name, else the kind and its number; the floor when it is not the main level. */
function doorText(door: KeyDoor, locale: AppLocale) {
  const place = door.name ? (locale === 'en' ? door.name.en : door.name.ru) : `${uiLabel(keyDoorKindLabel(door))}${door.number ? ` ${door.number}` : ''}`
  return [place, door.rawFloor ? uiText(door.floor) : ''].filter(Boolean).join(' · ')
}

/**
 * «Ключи локации» (report 186): a window over the whole app — it does not block it, and stays while the pages change — with the
 * location's keys three by three, scrolled by the wheel or the bar on the right. A key opens its card (prices, barters by the
 * player's levels); its pin opens the map with every door it opens lit, and «Назад к ключам» brings the list back. Dragged by
 * its header anywhere on the screen.
 */
export function LocationKeysWindow() {
  const keys = useLocationKeys()
  if (!keys.open) return null
  return createPortal(<KeysWindowBody />, document.body)
}

function KeysWindowBody() {
  const keys = useLocationKeys()
  const tarkov = useOptionalTarkovData()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const windowRef = useRef<HTMLElement>(null)
  const [card, setCard] = useState<Item | null>(null)
  const markers = tarkov?.data.markers
  const maps = useMemo(() => tarkov?.data.maps ?? [], [tarkov?.data.maps])
  const items = useMemo(() => new Map((tarkov?.data.items ?? []).map((item) => [item.id, item])), [tarkov?.data.items])
  const index = useMemo(() => (markers ? buildKeyDoorIndex(markers, maps) : new Map<string, KeyDoor[]>()), [markers, maps])
  const locations = useMemo(() => locationsWithKeys(index, maps), [index, maps])
  const mapId = locations.some((map) => canonicalMapId(map.id) === canonicalMapId(keys.mapId)) ? keys.mapId : locations[0]?.id ?? keys.mapId
  const list = useMemo(() => keysOfLocation(index, mapId, items), [index, mapId, items])
  const focused = keys.focus ? keysOfLocation(index, keys.focus.mapId, items).find((entry) => entry.keyId === keys.focus!.keyId) : undefined

  // the corner, kept inside the screen; a new window size (the phone turned) moves it back in
  const [position, setPosition] = useState(() => keys.position ?? defaultKeysPosition(WINDOW_WIDTH, window.innerWidth))
  useLayoutEffect(() => {
    const keep = () => {
      const box = windowRef.current?.getBoundingClientRect()
      setPosition((current) => clampKeysPosition(current, { width: box?.width ?? WINDOW_WIDTH, height: box?.height ?? 400 }, { width: window.innerWidth, height: window.innerHeight }))
    }
    keep()
    window.addEventListener('resize', keep)
    return () => window.removeEventListener('resize', keep)
  }, [])

  const drag = useRef<{ dx: number; dy: number; pointer: number } | null>(null)
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, select, a')) return
    drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y, pointer: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const box = windowRef.current?.getBoundingClientRect()
    setPosition(clampKeysPosition({ x: event.clientX - current.dx, y: event.clientY - current.dy }, { width: box?.width ?? WINDOW_WIDTH, height: box?.height ?? 400 }, { width: window.innerWidth, height: window.innerHeight }))
  }
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return
    drag.current = null
    locationKeys.move(position)
  }

  // «Назад к ключам»: the list again, and the map without the lit doors
  const back = () => {
    locationKeys.back()
    if (new URLSearchParams(location.search).has('keyDoors')) navigate(location.pathname, { replace: true })
  }
  // the map left by hand (from a map to another page): the lit doors went with it
  const lastPath = useRef(location.pathname)
  useEffect(() => {
    const left = lastPath.current.startsWith('/maps') && !location.pathname.startsWith('/maps')
    lastPath.current = location.pathname
    if (left && locationKeys.get().focus) locationKeys.back()
  }, [location.pathname])

  const showDoors = (keyId: string, doorId?: string) => {
    locationKeys.focus(keyId, mapId)
    navigate(keyDoorsHref(mapId, keyId, doorId))
  }

  const mapName = (id: string) => maps.find((map) => canonicalMapId(map.id) === canonicalMapId(id))?.name ?? id
  const keyName = (item: Item | undefined, keyId: string) => (item ? uiText(item.name) : keyId)

  return <>
    <section ref={windowRef} className="location-keys" style={{ left: position.x, top: position.y }} aria-label={uiText('Ключи локации')}>
      <header className="location-keys-head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <GripHorizontal className="location-keys-grip" size={16} aria-hidden="true" />
        {focused
          ? <button type="button" className="location-keys-back" onClick={back}><ArrowLeft size={15} />{uiText('Назад к ключам')}</button>
          : <>
            <KeyRound size={15} aria-hidden="true" />
            <strong>{uiText('Ключи')}</strong>
            <select className="location-keys-map" value={mapId} aria-label={uiText('Локация')} onChange={(event) => locationKeys.showMap(event.target.value)}>
              {locations.map((map) => <option key={map.id} value={map.id}>{uiText(map.name)}</option>)}
            </select>
          </>}
        <button type="button" className="location-keys-close" aria-label={uiText('Закрыть')} onClick={locationKeys.close}><X size={15} /></button>
      </header>
      {focused
        ? <div className="location-keys-focus">
          <button type="button" className="location-keys-focus-key" onClick={() => focused.item && setCard(focused.item)}>
            {focused.item?.iconUrl && <img src={focused.item.iconUrl} alt="" />}
            <span><strong>{keyName(focused.item, focused.keyId)}</strong><small>{uiText(mapName(keys.focus!.mapId))} · {doorsCount(focused.doors.length, locale)}</small></span>
          </button>
          <ul className="location-keys-doors">
            {focused.doors.map((door) => <li key={door.markerId}>
              <button type="button" onClick={() => showDoors(focused.keyId, door.markerId)}><MapPin size={14} aria-hidden="true" /><span>{doorText(door, locale)}</span></button>
            </li>)}
          </ul>
        </div>
        : <div className="location-keys-grid" role="list">
          {list.length === 0 && <p className="location-keys-empty">{uiText(tarkov ? 'На этой карте ключей нет' : 'Загружаем карту…')}</p>}
          {/* a short card as in «Требования рейда» (owner, 18.11.2026): the picture, the name, the pin under it */}
          {list.map(({ keyId, item, doors }) => <div key={keyId} className="location-key" role="listitem" title={keyName(item, keyId)}>
            <button type="button" className="location-key-open" aria-label={keyName(item, keyId)} onClick={() => item && setCard(item)} disabled={!item} />
            <span className="location-key-picture">{item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <KeyRound size={18} />}</span>
            <span className="location-key-copy">
              <span className="location-key-name">{item ? uiText(item.shortName || item.name) : keyId}</span>
              <button type="button" className="location-key-pin" aria-label={`${uiText('Показать на карте')} · ${keyName(item, keyId)}`} title={doors.length > 1 ? `${uiText('Показать двери на карте')} · ${doors.length}` : uiText('Показать дверь на карте')} onClick={() => showDoors(keyId)}>
                <MapPin size={11} />{doors.length > 1 && <b>{doors.length}</b>}
              </button>
            </span>
          </div>)}
        </div>}
    </section>
    {card && <ItemDrawer item={card} onClose={() => setCard(null)} />}
  </>
}
