import type { ReactNode } from 'react'
import { LockKeyhole } from 'lucide-react'
import type { GameMap } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { MapSlideshow } from './MapSlideshow'

/**
 * «Выбрать карту»: the list of maps that slides down over the maps' slideshow — the Overview's raid card and the squad's
 * «План на карте» (owner, 12.10.2026: «должно всплывать такое же окно как на обзоре»). Styles in styles/pages.css.
 */
export function MapPicker({ open, maps, firstMapId, onPick, lockedOf, noteOf }: {
  open: boolean
  maps: GameMap[]
  firstMapId: string
  onPick: (mapId: string) => void
  /** A map that cannot be picked (the Overview: closed by a quest), with why. */
  lockedOf?: (map: GameMap) => { locked: boolean; title?: string }
  /** Something to show at the end of a map's button (the squad plan: the group's quests there). */
  noteOf?: (map: GameMap) => ReactNode
}) {
  return <div className={`raid-map-picker ${open ? 'is-open' : ''}`} aria-hidden={!open}>
    <MapSlideshow active={open} firstMapId={firstMapId} />
    <div className="raid-map-picker-grid">
      {maps.map((map) => {
        const access = lockedOf?.(map) ?? { locked: false }
        const note = noteOf?.(map)
        return <button key={map.id} type="button" tabIndex={open ? 0 : -1} aria-disabled={access.locked} title={uiText(access.locked ? access.title ?? map.name : map.name)}
          onClick={() => { if (!access.locked) onPick(map.id) }}>
          <span className="map-color" style={{ background: map.accent }} />{uiText(map.name)}{access.locked && <LockKeyhole size={13} />}{note}
        </button>
      })}
    </div>
  </div>
}
