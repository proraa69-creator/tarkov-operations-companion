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
  limit?: number
}

/** Compact "Приоритет карт": top maps by current tasks as small tiles with a count badge and a thin bar. */
export function MapPriority({ maps, countFor, onOpen, limit = 5 }: MapPriorityProps) {
  const { locale } = useLocale()
  const rows = maps.map((map) => ({ map, count: countFor(map.id) })).sort((a, b) => b.count - a.count).slice(0, limit)
  const max = Math.max(1, ...rows.map((row) => row.count))
  const taskLabel = (count: number) => {
    if (locale === 'en') return `${count} ${count === 1 ? 'task' : 'tasks'}`
    const lastTwo = count % 100
    const last = count % 10
    const word = lastTwo >= 11 && lastTwo <= 14 ? 'заданий' : last === 1 ? 'задание' : last >= 2 && last <= 4 ? 'задания' : 'заданий'
    return `${count} ${word}`
  }

  return <section className="panel map-priority">
    <div className="panel-header"><div className="panel-title">{uiText('Приоритет карт')}</div><Link to="/maps" className="dim">{uiText('Все карты ')}<ChevronRight size={13} /></Link></div>
    <div className="map-priority-grid">
      {rows.map(({ map, count }, index) => {
        const label = `${uiText(map.name)} · ${taskLabel(count)}`
        return <button type="button" key={map.id} className={`map-priority-tile ${index === 0 && count > 0 ? 'is-top' : ''} ${count === 0 ? 'is-empty' : ''}`} title={label} aria-label={label} onClick={() => onOpen(map.id)}>
          <span className="map-priority-top">
            <span className="map-priority-rank mono">{String(index + 1).padStart(2, '0')}</span>
            <span className="map-priority-count">{count}</span>
          </span>
          <strong className="map-priority-name"><span className="map-priority-dot" style={{ background: map.accent }} aria-hidden="true" />{uiText(map.name)}</strong>
          <span className="map-priority-bar" aria-hidden="true"><span style={{ width: `${count / max * 100}%` }} /></span>
        </button>
      })}
    </div>
  </section>
}
