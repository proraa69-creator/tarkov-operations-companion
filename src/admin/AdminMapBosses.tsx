import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from 'lucide-react'
import { BOSS_MAP_IDS, FIGURE_MODES, MAP_BOSS_KEYS, mapBossName, type FigureMode, type MapBossEntry } from '../data/bossRoster'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import { uiLabel } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { draftMapBosses, withMapBosses } from './blocksDraft'

const MODE_LABEL: Record<FigureMode, string> = { pvp: 'PvP', pve: 'PvE', seasonal: 'Сезон' }

/**
 * «Боссы в блоке «План рейда»» (owner, 20.10.2026: «в админке редактирование боссов в блоке карта, который в блоке
 * обзор»): per map, which bosses stand in the raid card, in which modes and in which order (left to right). Part of the
 * «Блоки» draft, saved with «Сохранить для всех»; a map whose list is the built-in one stays on the built-in bosses
 * (src/data/bossRoster.ts), so later changes of the app reach it.
 */
export function AdminMapBosses({ value, disabled, onChange }: { value: Record<string, MapBossEntry[]>; disabled: boolean; onChange: (next: Record<string, MapBossEntry[]>) => void }) {
  const { locale } = useLocale()
  const [mapId, setMapId] = useState(BOSS_MAP_IDS[0] ?? '')
  const [adding, setAdding] = useState('')
  const list = draftMapBosses(value, mapId)
  const set = (next: MapBossEntry[]) => onChange(withMapBosses(value, mapId, next))
  const free = MAP_BOSS_KEYS.filter((key) => !list.some((entry) => entry.key === key))
  const mapName = (id: string) => uiLabel(MAP_DISPLAY_NAMES[id] ?? id)
  const bossName = (key: string) => mapBossName(key)[locale === 'en' ? 'en' : 'ru']

  const toggle = (index: number, mode: FigureMode) => set(list.map((entry, at) => (at !== index ? entry
    : { ...entry, modes: FIGURE_MODES.filter((own) => (own === mode ? !entry.modes.includes(mode) : entry.modes.includes(own))) })))
  const move = (index: number, step: -1 | 1) => {
    const next = [...list]
    const [entry] = next.splice(index, 1)
    next.splice(index + step, 0, entry!)
    set(next)
  }
  const add = () => {
    const key = free.includes(adding) ? adding : free[0]
    if (!key) return
    set([...list, { key, modes: [...FIGURE_MODES] }])
    setAdding('')
  }

  return (
    <div className="admin-map-bosses">
      <div className="admin-row">
        <label className="admin-map-bosses-field">
          <span>{uiLabel('Карта')}</span>
          <select className="select" value={mapId} onChange={(event) => { setMapId(event.target.value); setAdding('') }}>
            {BOSS_MAP_IDS.map((id) => <option key={id} value={id}>{mapName(id)}{value[id] ? ` · ${uiLabel('изменено')}` : ''}</option>)}
          </select>
        </label>
        {value[mapId] && (
          <button type="button" className="button small ghost" disabled={disabled} onClick={() => onChange(withMapBosses(value, mapId, draftMapBosses({}, mapId)))}>
            <RotateCcw size={13} aria-hidden="true" />{uiLabel('Стандартные боссы этой карты')}
          </button>
        )}
      </div>
      {list.length ? (
        <ol className="admin-order" aria-label={`${uiLabel('Боссы')}: ${mapName(mapId)}`}>
          {list.map((entry, index) => {
            const name = bossName(entry.key)
            return (
              <li key={entry.key} className="admin-map-boss">
                <span>{name}</span>
                <span className="admin-map-boss-modes">
                  {FIGURE_MODES.map((mode) => {
                    const on = entry.modes.includes(mode)
                    return (
                      <label key={mode} className="admin-check">
                        {/* The last mode stays: a boss in no mode is removed with ✕ instead. */}
                        <input type="checkbox" checked={on} disabled={disabled || (on && entry.modes.length === 1)} onChange={() => toggle(index, mode)} aria-label={`${name}: ${uiLabel(MODE_LABEL[mode])}`} />
                        {uiLabel(MODE_LABEL[mode])}
                      </label>
                    )
                  })}
                </span>
                <span className="admin-move">
                  <button type="button" className="icon-button small" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={`${name}: ${uiLabel('выше')}`} title={uiLabel('Выше')}><ArrowUp size={14} /></button>
                  <button type="button" className="icon-button small" disabled={disabled || index === list.length - 1} onClick={() => move(index, 1)} aria-label={`${name}: ${uiLabel('ниже')}`} title={uiLabel('Ниже')}><ArrowDown size={14} /></button>
                  <button type="button" className="icon-button small" disabled={disabled} onClick={() => set(list.filter((_, at) => at !== index))} aria-label={`${name}: ${uiLabel('убрать с карты')}`} title={uiLabel('Убрать с карты')}><X size={14} /></button>
                </span>
              </li>
            )
          })}
        </ol>
      ) : <small className="dim">{uiLabel('На этой карте боссов не будет.')}</small>}
      <div className="admin-row">
        <select className="select" value={free.includes(adding) ? adding : ''} disabled={disabled || !free.length} onChange={(event) => setAdding(event.target.value)} aria-label={uiLabel('Какого босса добавить')}>
          <option value="">{uiLabel(free.length ? 'Выберите босса' : 'Все боссы уже на карте')}</option>
          {free.map((key) => <option key={key} value={key}>{bossName(key)}</option>)}
        </select>
        <button type="button" className="button small" disabled={disabled || !free.includes(adding)} onClick={add}><Plus size={13} aria-hidden="true" />{uiLabel('Добавить на карту')}</button>
      </div>
    </div>
  )
}
