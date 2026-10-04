/* eslint-disable react-refresh/only-export-components */
import { uiText } from '../i18n/renderText'
import { useState } from 'react'
import { useMapEvents } from 'react-leaflet'
import { LoaderCircle, Skull, Trash2 } from 'lucide-react'
import { isOwnerApp } from '../app/buildEdition'
import { cleanIpcError } from '../sync/serverSync'
import { PLACEABLE_BOSSES, placementIdOf, useMapBossEditor } from '../data/mapBossPlacements'
import type { MapMarker } from '../domain/types'

/**
 * «Расставить боссов» (owner app only, server/src/routes/mapBosses.ts): pick a boss, click the map — the point is saved
 * on the server and every player's map shows it instead of the automatic markers of that boss on that map.
 * The selected floor goes with the point when it is not the main level.
 */
export function useBossPlacement(mapId: string, floor: string, baseFloor: string) {
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
  const remove = async (marker: MapMarker) => {
    const id = placementIdOf(marker)
    return id ? run(() => editor.remove(id)) : false
  }
  return { enabled, active: enabled && active, setActive, bossKey, setBossKey, busy, error, place, remove }
}

export type BossPlacementState = ReturnType<typeof useBossPlacement>

const round = (value: number) => Math.round(value * 10) / 10

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
          <select className="input boss-placement-select" value={state.bossKey} onChange={(event) => state.setBossKey(event.target.value)} aria-label={uiText('Босс')} title={uiText('Кликните по карте, чтобы поставить босса')}>
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

/** In the marker card of a hand-placed boss (owner app only). */
export function BossPlacementRemove({ state, marker, onRemoved }: { state: BossPlacementState; marker: MapMarker; onRemoved: () => void }) {
  if (!state.enabled || !placementIdOf(marker)) return null
  return (
    <div className="boss-placement-remove">
      <span className="dim">{uiText('Метка поставлена вручную, её видят все игроки.')}</span>
      <button type="button" className="button small danger" disabled={state.busy} onClick={() => void state.remove(marker).then((removed) => { if (removed) onRemoved() })}>
        <Trash2 size={13} />{uiText('Убрать с карты')}
      </button>
      {state.error && <small className="account-error">{uiText(state.error)}</small>}
    </div>
  )
}
