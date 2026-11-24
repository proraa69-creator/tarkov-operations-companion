import { useEffect, useRef } from 'react'
import { useBlockTitle } from '../overview/blockTitle'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { GameMap } from '../domain/types'

interface MapPriorityProps {
  maps: GameMap[]
  /** Current-stage tasks on this map. */
  countFor: (mapId: string) => number
  onOpen: (mapId: string) => void
  /** How many maps to show; all by default. */
  limit?: number
  /**
   * The map chosen in the block: its tile is the lit one (a player's chat, owner 14.11.2026: «выбрана карта берег а
   * подсвечивается улицы таркова, а должен подсвечиваться тоже берег»). The order stays by tasks. Without it the busiest map is lit.
   */
  selectedId?: string
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
export function MapPriority({ maps, countFor, onOpen, limit, selectedId, inline = false }: MapPriorityProps & { inline?: boolean }) {
  const { locale } = useLocale()
  const title = useBlockTitle('Приоритет карт')
  const rowRef = useWheelScrollsSideways<HTMLDivElement>()
  const rows = maps.map((map) => ({ map, count: countFor(map.id) })).sort((a, b) => b.count - a.count).slice(0, limit ?? maps.length)
  const max = Math.max(1, ...rows.map((row) => row.count))
  // The chosen map's tile comes into sight when the row scrolls sideways.
  useEffect(() => {
    const row = rowRef.current
    const tile = selectedId ? row?.querySelector<HTMLElement>(`[data-map-id="${CSS.escape(selectedId)}"]`) : null
    if (!row || !tile) return
    const left = tile.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft) row.scrollLeft = left
    else if (left + tile.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + tile.offsetWidth - row.clientWidth
  }, [selectedId, rowRef])
  const taskLabel = (count: number) => {
    if (locale === 'en') return `${count} ${count === 1 ? 'task' : 'tasks'}`
    const lastTwo = count % 100
    const last = count % 10
    const word = lastTwo >= 11 && lastTwo <= 14 ? 'заданий' : last === 1 ? 'задание' : last >= 2 && last <= 4 ? 'задания' : 'заданий'
    return `${count} ${word}`
  }

  // Inside the map's block (owner, 11.11.2026: «приоритет карт перенеси прямо в этот блок… колонка, которая листается влево-вправо»):
  // the strip alone, no panel, title or «Все карты».
  return <section className={inline ? 'map-priority is-inline' : 'panel map-priority'} aria-label={uiText('Приоритет карт')}>
    {!inline && <div className="panel-title map-priority-title">{title}</div>}
    <div className="map-priority-grid" ref={rowRef}>
      {rows.map(({ map, count }, index) => {
        const label = `${uiText(map.name)} · ${taskLabel(count)}`
        const lit = selectedId !== undefined ? map.id === selectedId : index === 0 && count > 0
        return <button type="button" key={map.id} data-map-id={map.id} className={`map-priority-tile ${lit ? 'is-top' : ''} ${count === 0 ? 'is-empty' : ''}`} title={label} aria-label={label}
          aria-pressed={selectedId !== undefined ? map.id === selectedId : undefined} onClick={() => onOpen(map.id)}>
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
