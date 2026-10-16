import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Camera, Image as ImageIcon, MapPin, Package, Pencil, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { CURATED_KIND_LABEL } from '../data/questRequirementOverrides'
import type { Item, MarkerHint, Quest } from '../domain/types'
import { PointItems, PointPhotos } from './PointPhotos'
import './questEditor.css'

/** The subtle «Raid OS» mark of what the owner added or corrected by hand. */
export function RaidOsMark() {
  return <span className="raidos-mark" title={uiText('Добавлено Raid OS: проверено вручную')}>{uiText('Raid OS')}</span>
}

/**
 * The point descriptions «Где искать: …» of a quest (the owner's text in the quest constructor). `stageIndex` keeps the
 * points of one story stage; `unattached` only the points of no objective (the others stand under their objective).
 */
export function QuestPointHints({ quest, stageIndex, unattached = false, mapId, onEditPoint }: { quest: Quest; stageIndex?: number | null; unattached?: boolean; mapId?: string; onEditPoint?: (markerId: string) => void }) {
  const hints = (quest.pointHints ?? []).filter((hint) => (stageIndex == null || hint.stageIndex === stageIndex) && (!unattached || !hint.objectiveId))
  if (!hints.length) return null
  // The map being viewed first.
  const sorted = mapId ? [...hints].sort((a, b) => Number(b.mapId === mapId) - Number(a.mapId === mapId)) : hints
  return (
    <div className="quest-point-hints">
      {sorted.map((hint) => <PointHintLine key={hint.markerId} hint={hint} onEdit={onEditPoint ? () => onEditPoint(hint.markerId) : undefined} />)}
    </div>
  )
}

/**
 * «Где искать: …» of one point, with the items to look for and the photos of the place (the point constructor).
 * `onEdit`: the owner's pencil (the point's settings).
 */
export function PointHintLine({ hint, onEdit }: { hint: { title?: string; text?: string; items?: Array<{ itemId: string; name: string; iconUrl?: string }>; photoIds?: string[] }; onEdit?: () => void }) {
  return (
    <div className="quest-point-hint-block">
      <p className="quest-point-hint">
        <MapPin size={12} aria-hidden="true" />
        <span>
          <strong>{uiText('Где искать')}{hint.title ? `: ${hint.title}` : ''}</strong>
          {hint.text && <span className="quest-point-hint-text">{hint.title ? ' — ' : ': '}{hint.text}</span>}
        </span>
        {onEdit && <button type="button" className="icon-button sheet-pencil" onClick={onEdit} aria-label={uiText('Изменить точку')} title={uiText('Изменить точку')}><Pencil size={12} /></button>}
      </p>
      {hint.items?.length ? <PointItems items={hint.items} /> : null}
      {hint.photoIds?.length ? <PointPhotos ids={hint.photoIds} /> : null}
    </div>
  )
}

/** The hint block in a map point's tooltip: the description and the items / keys the owner tied to this point. */
export function MarkerHintBlock({ hint }: { hint: MarkerHint }) {
  return (
    <div className="mmt-hint">
      {(hint.title || hint.text) && <PointHintLine hint={{ title: hint.title, text: hint.text }} />}
      {hint.items?.map((item) => (
        <p key={`item-${item.itemId}`} className="mmt-hint-need">
          {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <Package size={12} aria-hidden="true" />}
          <span>{uiText('Искать')}: {uiText(item.name)}</span>
        </p>
      ))}
      {hint.photoIds?.length ? <p className="mmt-hint-need"><Camera size={12} aria-hidden="true" /><span>{uiText(`Фото места: ${hint.photoIds.length}`)}</span></p> : null}
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

const guidePictures = import.meta.glob<string>('../assets/quest-guides/*.webp', { eager: true, import: 'default' })
const guidePicture = (file: string) => guidePictures[`../assets/quest-guides/${file}`]

/**
 * «Где искать» pictures of a curated quest (owner, 16.10.2026: «добавь картинки с найденными предметами, и вставь их в
 * описание нужного квеста, где искать»): thumbnails with captions; a click opens the picture full size.
 */
export function QuestGuideImages({ quest }: { quest: Pick<Quest, 'guideImages'> }) {
  const [open, setOpen] = useState<{ url: string; caption: string } | null>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const pictures = (quest.guideImages ?? []).flatMap((image) => { const url = guidePicture(image.file); return url ? [{ url, caption: image.caption }] : [] })
  if (!pictures.length) return null
  return (
    <div className="quest-guide-images">
      {pictures.map((picture) => (
        <button key={picture.url} type="button" className="quest-guide-image" onClick={() => setOpen(picture)} title={picture.caption}>
          <img src={picture.url} alt={picture.caption} loading="lazy" />
          <span><ImageIcon size={11} aria-hidden="true" />{picture.caption}</span>
        </button>
      ))}
      {open && createPortal(
        <div className="quest-guide-full" role="dialog" aria-modal="true" aria-label={open.caption} onClick={() => setOpen(null)}>
          <figure><img src={open.url} alt={open.caption} /><figcaption>{open.caption}</figcaption></figure>
          <button type="button" className="icon-button" aria-label={uiText('Закрыть')} onClick={() => setOpen(null)}><X size={16} /></button>
        </div>,
        document.body,
      )}
    </div>
  )
}
