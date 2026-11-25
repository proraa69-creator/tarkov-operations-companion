import { useEffect, useRef } from 'react'
import { useBlockTitle } from '../overview/blockTitle'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { GameMap } from '../domain/types'
import { filteredCount, type MapWorkCounts, type MapWorkFilter } from '../progression/mapPriority'
import { setMapWorkFilter, useMapWorkFilter } from '../overview/mapWorkFilter'

interface MapPriorityProps {
  maps: GameMap[]
  /** The current quests with work left on this map, by kind (progression/mapPriority.ts). */
  countFor: (mapId: string) => MapWorkCounts
  onOpen: (mapId: string) => void
  /** How many maps to show; all by default. */
  limit?: number
  /**
   * The map chosen in the block: its tile is the lit one (a player's chat, owner 14.11.2026: «выбрана карта берег а
   * подсвечивается улицы таркова, а должен подсвечиваться тоже берег»). The order stays by tasks. Without it the busiest map is lit.
   */
  selectedId?: string
  /**
   * «Все» / «Задания» / «Устранения» before the tiles (report 230). Not on the phone: its row has no room for it there, and
   * without the switch the tiles count all quests.
   */
  filterable?: boolean
}

/**
 * The wheel scrolls the tile row sideways while the pointer is over it and there is more to see in that direction;
 * at either end the page scrolls as usual. React's onWheel is passive, so the listener is attached by hand.
 */
function useWheelScrollsSideways<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const max = row.scrollWidth - row.clientWidth
      if (max <= 1) return
      const step = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? row.clientWidth : 1)
      if ((step < 0 && row.scrollLeft <= 0) || (step > 0 && row.scrollLeft >= max - 1)) return
      event.preventDefault()
      row.scrollLeft += step
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => row.removeEventListener('wheel', onWheel)
  }, [])
  return ref
}

/**
 * "Приоритет карт": one thin strip across the Overview under the stat cards — title, the maps by current tasks as
 * one-line tiles (rank · map · count) over a thin bar, «Все карты». Tiles stretch to fill the row; when they do not fit, the row scrolls sideways
 * (wheel over it, drag on a touchpad, or the thin scrollbar).
 */
export function MapPriority({ maps, countFor, onOpen, limit, selectedId, filterable = false, inline = false }: MapPriorityProps & { inline?: boolean }) {
  const { locale } = useLocale()
  const title = useBlockTitle('Приоритет карт')
  const rowRef = useWheelScrollsSideways<HTMLDivElement>()
  const chosenFilter = useMapWorkFilter()
  const filter: MapWorkFilter = filterable ? chosenFilter : 'all'
  const rows = maps.map((map) => { const counts = countFor(map.id); return { map, counts, count: filteredCount(counts, filter), total: counts.tasks + counts.kills } })
    .sort((a, b) => b.count - a.count || b.total - a.total).slice(0, limit ?? maps.length)
  const max = Math.max(1, ...rows.map((row) => row.count))
  // The tile the player clicks stays where it is under the pointer (report 229: «меня как бы слегка отбрасывает вправо»: the
  // row scrolled a tile cut by its edge into full sight). A map chosen elsewhere («Выбрать карту», the squad) is brought into
  // sight when the row does not show it.
  const clicked = useRef<string | undefined>(undefined)
  useEffect(() => {
    const row = rowRef.current
    const tile = selectedId ? row?.querySelector<HTMLElement>(`[data-map-id="${CSS.escape(selectedId)}"]`) : null
    const byClick = clicked.current === selectedId
    clicked.current = undefined
    if (!row || !tile || byClick) return
    const box = row.getBoundingClientRect()
    const own = tile.getBoundingClientRect()
    if (own.left < box.left) row.scrollLeft -= box.left - own.left
    else if (own.right > box.right) row.scrollLeft += Math.min(own.right - box.right, own.left - box.left)
  }, [selectedId, rowRef])
  // Another count puts the maps in another order: the row starts over from the busiest one.
  const shownFilter = useRef(filter)
  useEffect(() => {
    if (shownFilter.current === filter) return
    shownFilter.current = filter
    if (rowRef.current) rowRef.current.scrollLeft = 0
  }, [filter, rowRef])
  const taskLabel = (count: number) => {
    if (locale === 'en') return `${count} ${count === 1 ? 'task' : 'tasks'}`
    const lastTwo = count % 100
    const last = count % 10
    const word = lastTwo >= 11 && lastTwo <= 14 ? 'заданий' : last === 1 ? 'задание' : last >= 2 && last <= 4 ? 'задания' : 'заданий'
    return `${count} ${word}`
  }

  // Inside the map's block (owner, 11.11.2026: «приоритет карт перенеси прямо в этот блок… колонка, которая листается влево-вправо»):
  // the strip alone, no panel, title or «Все карты».
  const filters: Array<[MapWorkFilter, string]> = [['all', 'Все'], ['tasks', 'Задания'], ['kills', 'Устранения']]
  return <section className={inline ? 'map-priority is-inline' : 'panel map-priority'} aria-label={uiText('Приоритет карт')}>
    {!inline && <div className="panel-title map-priority-title">{title}</div>}
    {filterable && <div className="map-priority-filter" role="group" aria-label={uiText('Какие квесты считать')}>
      {filters.map(([value, label]) => <button type="button" key={value} className={filter === value ? 'is-active' : ''} aria-pressed={filter === value}
        onClick={() => setMapWorkFilter(value)}>{uiText(label)}</button>)}
    </div>}
    <div className="map-priority-grid" ref={rowRef}>
      {rows.map(({ map, counts, count }, index) => {
        const label = `${uiText(map.name)} · ${taskLabel(count)}`
        // On hover, what the count is made of.
        const parts = locale === 'en' ? `${counts.tasks} + ${counts.kills} eliminations` : `${counts.tasks} + ${counts.kills} на устранение`
        const hint = filter === 'all' && counts.kills > 0 ? `${label}: ${parts}` : label
        const lit = selectedId !== undefined ? map.id === selectedId : index === 0 && count > 0
        return <button type="button" key={map.id} data-map-id={map.id} className={`map-priority-tile ${lit ? 'is-top' : ''} ${count === 0 ? 'is-empty' : ''}`} title={hint} aria-label={label}
          aria-pressed={selectedId !== undefined ? map.id === selectedId : undefined} onClick={() => { if (map.id !== selectedId) clicked.current = map.id; onOpen(map.id) }}>
          <span className="map-priority-rank mono">{String(index + 1).padStart(2, '0')}</span>
          <strong className="map-priority-name"><span className="map-priority-dot" style={{ background: map.accent }} aria-hidden="true" /><span className="map-priority-label">{uiText(map.name)}</span></strong>
          <span className="map-priority-count">{count}</span>
          <span className="map-priority-bar" aria-hidden="true"><span style={{ width: `${count / max * 100}%` }} /></span>
        </button>
      })}
    </div>
    {!inline && <Link to="/maps" className="dim map-priority-all">{uiText('Все карты ')}<ChevronRight size={13} /></Link>}
  </section>
}
