import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Package } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { CURATED_KIND_LABEL } from '../data/questRequirementOverrides'
import type { Item, MarkerHint, Quest } from '../domain/types'
import './questEditor.css'

/** The subtle «Raid OS» mark of what the owner added or corrected by hand. */
export function RaidOsMark() {
  return <span className="raidos-mark" title={uiText('Добавлено Raid OS: проверено вручную')}>{uiText('Raid OS')}</span>
}

/**
 * The point descriptions «Где искать: …» of a quest (the owner's text in the quest constructor). `stageIndex` keeps the
 * points of one story stage; `unattached` only the points of no objective (the others stand under their objective).
 */
export function QuestPointHints({ quest, stageIndex, unattached = false, mapId }: { quest: Quest; stageIndex?: number | null; unattached?: boolean; mapId?: string }) {
  const hints = (quest.pointHints ?? []).filter((hint) => (stageIndex == null || hint.stageIndex === stageIndex) && (!unattached || !hint.objectiveId))
  if (!hints.length) return null
  // The map being viewed first.
  const sorted = mapId ? [...hints].sort((a, b) => Number(b.mapId === mapId) - Number(a.mapId === mapId)) : hints
  return (
    <div className="quest-point-hints">
      {sorted.map((hint) => <PointHintLine key={hint.markerId} hint={hint} />)}
    </div>
  )
}

/** «Где искать: …» of one point. */
export function PointHintLine({ hint }: { hint: { title?: string; text?: string } }) {
  return (
    <p className="quest-point-hint">
      <MapPin size={12} aria-hidden="true" />
      <span>
        <strong>{uiText('Где искать')}{hint.title ? `: ${hint.title}` : ''}</strong>
        {hint.text && <span className="quest-point-hint-text">{hint.title ? ' — ' : ': '}{hint.text}</span>}
      </span>
    </p>
  )
}

/** The hint block in a map point's tooltip: the description and the items / keys the owner tied to this point. */
export function MarkerHintBlock({ hint }: { hint: MarkerHint }) {
  return (
    <div className="mmt-hint">
      {(hint.title || hint.text) && <PointHintLine hint={hint} />}
      {hint.needs?.map((need) => (
        <p key={`${need.itemId}-${need.kind}`} className="mmt-hint-need">
          {need.iconUrl ? <img src={need.iconUrl} alt="" loading="lazy" /> : <Package size={12} aria-hidden="true" />}
          <span>{uiText(CURATED_KIND_LABEL[need.kind as keyof typeof CURATED_KIND_LABEL] ?? need.kind)}: {uiText(need.name)}{need.count > 1 ? ` ×${need.count}` : ''}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * «Требуется» rows the owner added or corrected (quest page, quest card under the map): item, kind, count, «найден в
 * рейде» and the comment, each with the «Raid OS» mark. Nothing when the quest has none.
 */
export function QuestCuratedRequirements({ quest, items: list, title = 'Требуется' }: { quest: Quest; items: Item[]; title?: string }) {
  const rows = (quest.raidRequirements ?? []).filter((requirement) => requirement.curated)
  const items = useMemo(() => new Map(rows.length ? list.map((item) => [item.id, item]) : []), [rows.length, list])
  if (!rows.length) return null
  return (
    <div className="detail-section quest-curated">
      <h4>{uiText(title)} <RaidOsMark /></h4>
      <ul className="quest-curated-list">
        {rows.map((requirement) => {
          const item = items.get(requirement.itemId)
          const curated = requirement.curated!
          return (
            <li key={curated.id}>
              <Link to={`/flea?selected=${requirement.itemId}`} className="quest-curated-item">
                {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="quest-curated-empty"><Package size={16} /></span>}
                <span>
                  <strong>{uiText(item?.name ?? requirement.itemId)}{requirement.count > 1 ? ` ×${requirement.count}` : ''}</strong>
                  <small>
                    {uiText(CURATED_KIND_LABEL[curated.kind])}
                    {requirement.foundInRaid ? ` · ${uiText('найден в рейде')}` : ''}
                  </small>
                  {curated.comment && <small className="quest-curated-comment">{curated.comment}</small>}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
