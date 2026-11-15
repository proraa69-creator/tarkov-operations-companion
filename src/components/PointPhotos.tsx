import { useState } from 'react'
import { ImageOff, LoaderCircle, Package, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { questPointPhotoUrl, useQuestPointPhoto } from '../data/questPointPhotos'
import { ImageViewer } from './ImageViewer'
import './questEditor.css'
import './questGuidePhotos.css'

/**
 * The photos of a point «где искать» (the point constructor), as large as the places' photos elsewhere (owner, 15.11.2026:
 * «все скриншоты, которые я прилагаю, должны открываться, как и везде… фотография слева такая, крупненькая, не мелкая»):
 * to players one large photo and a small tile «+N» for the rest (the map's quest window, QuestGuidePhotos.tsx
 * ObjectivePhotoPopup); in the point window (`onRemove`, the owner's «×» on each) every photo large. A click opens them
 * full size (components/ImageViewer.tsx); a second click closes it, as everywhere.
 */
export function PointPhotos({ ids, onRemove }: { ids: string[]; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState<{ urls: string[]; index: number } | null>(null)
  if (!ids.length) return null
  const show = async (index: number) => {
    const urls = await Promise.all(ids.map((id) => questPointPhotoUrl(id).catch(() => '')))
    const shown = urls.filter(Boolean)
    const at = shown.indexOf(urls[index] ?? '')
    if (shown.length) setOpen({ urls: shown, index: Math.max(0, at) })
  }
  const viewer = open && <ImageViewer images={open.urls} index={open.index} onIndex={(index) => setOpen({ ...open, index })} onClose={() => setOpen(null)} closeOnClick />
  if (onRemove) {
    return (
      <div className="point-photos is-editing" role="list" aria-label={uiText('Фото точки')}>
        {ids.map((id, index) => (
          <span key={id} className="point-photo" role="listitem">
            <PhotoTile id={id} inList onOpen={() => void show(index)} />
            <button type="button" className="point-photo-remove" onClick={() => onRemove(id)} aria-label={uiText('Убрать фото')} title={uiText('Убрать фото')}><X size={14} /></button>
          </span>
        ))}
        {viewer}
      </div>
    )
  }
  const more = ids.length - 1
  return (
    <div className={`point-photos objective-photo-grid${more ? ' has-more' : ''}`} role="list" aria-label={uiText('Фото точки')}>
      <PhotoTile id={ids[0]} onOpen={() => void show(0)} />
      {more > 0 && <PhotoTile id={ids[1]} more={more} onOpen={() => void show(1)} />}
      {viewer}
    </div>
  )
}

/** One photo as the places' photos have it: large (`more`: the small tile with how many more there are). */
function PhotoTile({ id, more, inList, onOpen }: { id: string; more?: number; inList?: boolean; onOpen: () => void }) {
  const photo = useQuestPointPhoto(id)
  const kind = `objective-photo point-photo-tile ${more ? 'is-more' : 'is-main'}`
  const role = inList ? undefined : 'listitem'
  if (photo.failed) return <span role={role} className={`${kind} is-missing`} title={uiText('Фото видно после входа в аккаунт')}><ImageOff size={18} /></span>
  if (!photo.url) return <span role={role} className={`${kind} is-loading`}><LoaderCircle size={18} className="spin" aria-label={uiText('Загрузка фото…')} /></span>
  return (
    <button type="button" role={role} className={kind} onClick={onOpen} title={more ? `${uiText('Ещё фото')}: ${more}` : uiText('Открыть фото')}>
      <img src={photo.url} alt={more ? '' : uiText('Фото: где искать')} />
      {more ? <b aria-hidden="true">+{more}</b> : null}
    </button>
  )
}

/**
 * «Выбрать фото места» in the point window: the place photos the owner already added to other points (this quest's
 * first), small; a click puts one on this point too.
 */
export function PlacePhotoChoice({ ids, onPick, onClose }: { ids: string[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="point-photo-choice">
      <div className="point-photo-choice-head">
        <span>{uiText('Фото с других точек')}</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={13} /></button>
      </div>
      <div className="point-photo-choice-grid" role="list" aria-label={uiText('Фото с других точек')}>
        {ids.map((id) => <ChoiceTile key={id} id={id} onPick={() => onPick(id)} />)}
      </div>
    </div>
  )
}

function ChoiceTile({ id, onPick }: { id: string; onPick: () => void }) {
  const photo = useQuestPointPhoto(id)
  if (photo.failed) return null
  return (
    <button type="button" role="listitem" className="point-photo-choice-tile" onClick={onPick} disabled={!photo.url} title={uiText('Выбрать фото места')}>
      {photo.url ? <img src={photo.url} alt={uiText('Фото места')} /> : <LoaderCircle size={16} className="spin" aria-label={uiText('Загрузка фото…')} />}
    </button>
  )
}

/** Catalog items of a point («что искать»): icon and name. */
export function PointItems({ items, onRemove }: { items: Array<{ itemId: string; name: string; iconUrl?: string }>; onRemove?: (itemId: string) => void }) {
  if (!items.length) return null
  return (
    <ul className="point-items" aria-label={uiText('Предметы точки')}>
      {items.map((item) => (
        <li key={item.itemId}>
          {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <Package size={14} aria-hidden="true" />}
          <span>{uiText(item.name)}</span>
          {onRemove && <button type="button" className="icon-button" onClick={() => onRemove(item.itemId)} aria-label={uiText('Убрать предмет')} title={uiText('Убрать предмет')}><X size={11} /></button>}
        </li>
      ))}
    </ul>
  )
}
