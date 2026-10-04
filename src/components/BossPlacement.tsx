/* eslint-disable react-refresh/only-export-components */
import { uiText } from '../i18n/renderText'
import { useState } from 'react'
import { useMapEvents } from 'react-leaflet'
import { LoaderCircle, Repeat, Skull, Trash2 } from 'lucide-react'
import { isOwnerApp } from '../app/buildEdition'
import { cleanIpcError } from '../sync/serverSync'
import { bossKeyOf, OWNER_BOSS_SOURCE, PLACEABLE_BOSSES, placementIdOf, useMapBossEditor, type NewMapBossPlacement } from '../data/mapBossPlacements'
import type { MapMarker } from '../domain/types'

/**
 * «Расставить боссов» (owner app only, server/src/routes/mapBosses.ts): pick a boss, click the map — the point is saved
 * on the server and every player's map shows it instead of the automatic markers of that boss on that map.
 * The selected floor goes with the point when it is not the main level.
 */
export function useBossPlacement(mapId: string, floor: string, baseFloor: string, bossMarkers: MapMarker[] = []) {
  const enabled = isOwnerApp()
  const editor = useMapBossEditor()
  const [active, setActive] = useState(false)
  const [bossKey, setBossKey] = useState(PLACEABLE_BOSSES[0].key)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** True when the server accepted the change. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); return true } catch (reason) { setError(ownerError(reason)); return false } finally { setBusy(false) }
  }
  const place = (x: number, z: number) => {
    const boss = PLACEABLE_BOSSES.find((entry) => entry.key === bossKey) ?? PLACEABLE_BOSSES[0]
    void run(() => editor.place({ mapId, bossKey: boss.key, bossName: boss.name, x: round(x), z: round(z), ...(floor !== baseFloor ? { floor } : {}) }))
  }
  /** A catalog / placed boss marker as a new placement (optionally moved, swapped or hidden). */
  const asPlacement = (marker: MapMarker, over: Partial<NewMapBossPlacement> = {}): NewMapBossPlacement => ({
    mapId,
    bossKey: bossKeySlug(marker),
    bossName: marker.boss?.name ?? marker.title,
    x: round(marker.position[1]),
    z: round(marker.position[0]),
    ...(marker.floor && marker.floor !== baseFloor ? { floor: marker.floor } : {}),
    ...over,
  })
  /** The automatic markers of the same boss on this map (a placement of that boss hides all of them). */
  const automaticSiblings = (marker: MapMarker) => bossMarkers.filter((entry) => entry.source !== OWNER_BOSS_SOURCE && entry.mapId === mapId && bossKeyOf(entry) === bossKeyOf(marker))
  /**
   * Changes an automatic boss: its other automatic points on this map become placements as they are (so nothing else
   * disappears), the changed one gets `change` (none = deleted; then a hidden placement keeps the automatic one away).
   */
  const rewriteAutomatic = async (marker: MapMarker, change?: Partial<NewMapBossPlacement>) => {
    const others = automaticSiblings(marker).filter((entry) => entry.id !== marker.id)
    for (const entry of others) await editor.place(asPlacement(entry))
    if (change) await editor.place(asPlacement(marker, change))
    const sameBoss = !change || ((change.bossKey ?? bossKeySlug(marker)) === bossKeySlug(marker))
    if (!others.length && !sameBoss) await editor.place(asPlacement(marker, { hidden: true }))
    if (!others.length && !change) await editor.place(asPlacement(marker, { hidden: true }))
  }
  /** Drag and drop: saved at once. */
  const move = (marker: MapMarker, x: number, z: number) => run(async () => {
    const id = placementIdOf(marker)
    if (id) { await editor.place(asPlacement(marker, { x: round(x), z: round(z) })); await editor.remove(id) } else await rewriteAutomatic(marker, { x: round(x), z: round(z) })
  })
  const remove = (marker: MapMarker) => run(async () => {
    const id = placementIdOf(marker)
    if (id) await editor.remove(id); else await rewriteAutomatic(marker)
  })
  const replace = (marker: MapMarker, key: string) => run(async () => {
    const boss = PLACEABLE_BOSSES.find((entry) => entry.key === key)
    if (!boss) return
    const id = placementIdOf(marker)
    if (id) { await editor.place(asPlacement(marker, { bossKey: boss.key, bossName: boss.name })); await editor.remove(id) } else await rewriteAutomatic(marker, { bossKey: boss.key, bossName: boss.name })
  })
  return { enabled, active: enabled && active, setActive, bossKey, setBossKey, busy, error, place, move, remove, replace }
}

export type BossPlacementState = ReturnType<typeof useBossPlacement>

const round = (value: number) => Math.round(value * 10) / 10
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/
/** The server's boss key for a marker: its own key, the known boss with that name, or a generic one. */
function bossKeySlug(marker: MapMarker) {
  const own = marker.boss?.key?.toLowerCase()
  if (own && SLUG.test(own)) return own
  const name = (marker.boss?.name ?? marker.title).toLowerCase()
  return PLACEABLE_BOSSES.find((entry) => entry.name.toLowerCase() === name)?.key ?? 'boss'
}

function ownerError(reason: unknown) {
  const message = cleanIpcError(reason)
  if (/Не найдено|Неизвестный запрос/.test(message)) return 'Расставлять боссов может только аккаунт владельца.'
  if (/Требуется вход|Сессия истекла/.test(message)) return 'Войдите в аккаунт владельца на сервере.'
  return message || 'Сервер недоступен'
}

/** The map-hud button and, while placing, the boss list. */
export function BossPlacementControls({ state }: { state: BossPlacementState }) {
  if (!state.enabled) return null
  return (
    <div className="map-tools boss-placement">
      <button type="button" className={`map-tool${state.active ? ' active' : ''}`} aria-pressed={state.active} onClick={() => state.setActive(!state.active)} title={uiText('Поставить босса на карту вручную: метку увидят все игроки')}>
        <Skull size={14} />{uiText('Расставить боссов')}
      </button>
      {state.active && (
        <>
          <select className="input boss-placement-select" value={state.bossKey} onChange={(event) => state.setBossKey(event.target.value)} aria-label={uiText('Босс')} title={uiText('Клик по карте — поставить выбранного босса; босса на карте можно перетащить мышью, а по клику — удалить или заменить')}>
            {PLACEABLE_BOSSES.map((boss) => <option key={boss.key} value={boss.key}>{uiText(boss.name)}</option>)}
          </select>
          {(state.busy || state.error) && (
            <span className="boss-placement-hint">
              {state.busy ? <LoaderCircle size={13} className="spin" /> : uiText(state.error)}
            </span>
          )}
        </>
      )}
    </div>
  )
}

/** Inside the MapContainer: a click while placing saves the point (lat = z, lng = x in game metres). */
export function BossPlacementLayer({ state }: { state: BossPlacementState }) {
  useMapEvents({
    click: (event) => { if (state.active && !state.busy) state.place(event.latlng.lng, event.latlng.lat) },
  })
  return null
}

/**
 * In a boss marker's card while «Расставить боссов» is on (and for a hand-placed boss in the owner app): delete it or
 * swap it for another boss. Saved at once; the marker itself can be dragged on the map.
 */
export function BossPlacementRemove({ state, marker, onRemoved }: { state: BossPlacementState; marker: MapMarker; onRemoved: () => void }) {
  const [swap, setSwap] = useState('')
  const manual = Boolean(placementIdOf(marker))
  if (!state.enabled || marker.type !== 'boss' || (!state.active && !manual)) return null
  return (
    <div className="boss-placement-remove">
      <span className="dim">{uiText(manual ? 'Метка поставлена вручную, её видят все игроки.' : 'Автоматическая метка: перетащите её, удалите или замените — изменения сохраняются сразу и видны всем игрокам.')}</span>
      <div className="boss-placement-actions">
        <select className="input boss-placement-select" value={swap} onChange={(event) => setSwap(event.target.value)} aria-label={uiText('Заменить на')} disabled={state.busy}>
          <option value="">{uiText('Заменить на…')}</option>
          {PLACEABLE_BOSSES.filter((boss) => boss.key !== marker.boss?.key).map((boss) => <option key={boss.key} value={boss.key}>{uiText(boss.name)}</option>)}
        </select>
        <button type="button" className="button small" disabled={state.busy || !swap} onClick={() => void state.replace(marker, swap).then((ok) => { if (ok) { setSwap(''); onRemoved() } })}>
          <Repeat size={13} />{uiText('Заменить')}
        </button>
        <button type="button" className="button small danger" disabled={state.busy} onClick={() => void state.remove(marker).then((removed) => { if (removed) onRemoved() })}>
          <Trash2 size={13} />{uiText('Удалить')}
        </button>
      </div>
      {state.error && <small className="account-error">{uiText(state.error)}</small>}
    </div>
  )
}
