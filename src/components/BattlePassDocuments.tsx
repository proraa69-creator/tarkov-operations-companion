import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, Undo2, X } from 'lucide-react'
import { DOCUMENT_PICTURES } from '../assets/documentMarkers'
import { APPROXIMATE_NOTE, BATTLE_PASS_DOCUMENT_KINDS, battlePassDocumentKindsOf, battlePassDocumentPointOf, type BattlePassDocumentKind } from '../data/battlePassDocuments'
import { documentPhotoUrl, pointPhotos, useDocumentGuide, type DocumentGuide } from '../data/documentGuide'
import type { MapMarker } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { ImageViewer } from './ImageViewer'
import './battlePassDocuments.css'

function KindChip({ kind, count }: { kind: BattlePassDocumentKind; count?: number }) {
  const { locale } = useLocale()
  return (
    <span className="document-kind">
      <img src={DOCUMENT_PICTURES[kind]} alt="" draggable={false} />
      <span>{BATTLE_PASS_DOCUMENT_KINDS[kind][locale === 'en' ? 'en' : 'ru']}</span>
      {count !== undefined && <small>{count}</small>}
    </span>
  )
}

/** Photos with their captions; a click enlarges one, the arrows go through them and a second click closes it. No source line. */
function DocumentPhotos({ guide, ids }: { guide: DocumentGuide; ids: readonly string[] }) {
  const { locale } = useLocale()
  const [open, setOpen] = useState<number | null>(null)
  const images = useMemo(() => ids.map((id) => documentPhotoUrl(guide, id, false)), [guide, ids])
  return <>
    <div className="document-photos" role="list">
      {ids.map((id, index) => {
        const caption = guide.photos[id]?.[locale === 'en' ? 'en' : 'ru'] ?? ''
        return (
          <button key={id} type="button" role="listitem" className="document-photo" title={caption} onClick={() => setOpen(index)}>
            <img src={documentPhotoUrl(guide, id, true)} alt={caption} loading="lazy" decoding="async" />
            <span>{caption}</span>
          </button>
        )
      })}
    </div>
    {open !== null && <ImageViewer images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} closeOnClick />}
  </>
}

/**
 * A document's card on the map: its kinds, where, «Нашёл» (progression/foundDocuments.ts: the point leaves the map until the raid
 * ends) and the photos of this very place (owner, 05.11.2026). The other places of this map are one click away, for a point the
 * photos could not be tied to.
 */
export function BattlePassDocumentCard({ marker, onFound, onAllPlaces }: { marker: MapMarker; onFound: () => void; onAllPlaces: () => void }) {
  const { locale } = useLocale()
  const guide = useDocumentGuide()
  const point = battlePassDocumentPointOf(marker)
  const kinds = battlePassDocumentKindsOf(marker)
  const photos = pointPhotos(guide, marker.mapId, marker.position, kinds)
  const place = point?.place?.[locale === 'en' ? 'en' : 'ru']
  return <>
    <div className="document-kinds">{kinds.map((kind) => <KindChip key={kind} kind={kind} />)}</div>
    {/* A pin placed by hand says where and that it is approximate; a point of the game's feed needs neither. */}
    {point && <p className="dim document-place">{place ?? (point.near ? `${uiText('Ориентир:')} ${point.near}` : '')} {uiText(APPROXIMATE_NOTE)}</p>}
    <div className="document-actions">
      <button type="button" className="button small primary document-found" title={uiText('Убрать с карты до конца рейда')} onClick={onFound}><Check size={14} aria-hidden="true" />{uiText('Нашёл')}</button>
      <button type="button" className="button small ghost" onClick={onAllPlaces}><Camera size={13} aria-hidden="true" />{uiText('Все места на карте')}</button>
    </div>
    {guide && photos.length > 0 && <DocumentPhotos guide={guide} ids={photos} />}
  </>
}

/** All photos of this map's documents, by kind: places no point stands for too, and Icebreaker, which has no points yet. */
export function BattlePassDocumentGallery({ mapId, onClose }: { mapId: string; onClose: () => void }) {
  const guide = useDocumentGuide()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const kinds = Object.entries(guide?.maps[mapId] ?? {}) as Array<[BattlePassDocumentKind, string[]]>
  return createPortal(
    <div className="registration-overlay document-gallery-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog document-gallery" role="dialog" aria-modal="true" aria-label={uiText('Все места на карте')}>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2>{uiText('Все места на карте')}</h2>
        {guide && kinds.map(([kind, ids]) => (
          <div key={kind} className="document-gallery-kind">
            <KindChip kind={kind} count={ids.length} />
            <DocumentPhotos guide={guide} ids={ids} />
          </div>
        ))}
      </section>
    </div>,
    document.body,
  )
}

/**
 * Under the layer's row: which picture is which kind on this map, the photos of its places, and «Вернуть найденные» while
 * something is ticked, or a slip of the finger would stay off the map until the raid ends.
 */
export function DocumentLayerDetails({ mapId, markers, foundCount, onAllPlaces, onBringBack }: { mapId: string; markers: readonly MapMarker[]; foundCount: number; onAllPlaces: () => void; onBringBack: () => void }) {
  const guide = useDocumentGuide()
  const counts = useMemo(() => {
    const byKind = new Map<BattlePassDocumentKind, number>()
    for (const kind of Object.keys(guide?.maps[mapId] ?? {}) as BattlePassDocumentKind[]) byKind.set(kind, 0)
    for (const marker of markers) for (const kind of battlePassDocumentKindsOf(marker)) byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
    return [...byKind]
  }, [guide, mapId, markers])
  const photos = Object.values(guide?.maps[mapId] ?? {}).reduce((sum, ids) => sum + (ids?.length ?? 0), 0)
  if (!counts.length && !foundCount) return null
  return (
    <div className="document-layer-details">
      {counts.map(([kind, count]) => <KindChip key={kind} kind={kind} count={count} />)}
      {photos > 0 && <button type="button" className="document-layer-action" onClick={onAllPlaces}><Camera size={12} aria-hidden="true" />{uiText('Все места на карте')} ({photos})</button>}
      {foundCount > 0 && <button type="button" className="document-layer-action" onClick={onBringBack}><Undo2 size={12} aria-hidden="true" />{uiText('Вернуть найденные')} ({foundCount})</button>}
    </div>
  )
}
