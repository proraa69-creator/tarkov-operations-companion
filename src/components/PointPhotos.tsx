import { useState } from 'react'
import { ImageOff, LoaderCircle, Package, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { questPointPhotoUrl, useQuestPointPhoto } from '../data/questPointPhotos'
import { ImageViewer } from './ImageViewer'
import './questEditor.css'

/**
 * The photos of a point «где искать» (the point constructor): thumbnails that load one by one; a click opens them full
 * size (components/ImageViewer.tsx). `onRemove`: the owner's «×» on each (the point settings).
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
  return (
    <div className="point-photos" role="list" aria-label={uiText('Фото точки')}>
      {ids.map((id, index) => (
        <span key={id} className="point-photo" role="listitem">
          <PhotoThumb id={id} onOpen={() => void show(index)} />
          {onRemove && <button type="button" className="point-photo-remove" onClick={() => onRemove(id)} aria-label={uiText('Убрать фото')} title={uiText('Убрать фото')}><X size={11} /></button>}
        </span>
      ))}
      {open && <ImageViewer images={open.urls} index={open.index} onIndex={(index) => setOpen({ ...open, index })} onClose={() => setOpen(null)} />}
    </div>
  )
}

function PhotoThumb({ id, onOpen }: { id: string; onOpen: () => void }) {
  const photo = useQuestPointPhoto(id)
  if (photo.failed) return <span className="point-photo-thumb is-missing" title={uiText('Фото видно после входа в аккаунт')}><ImageOff size={14} /></span>
  if (!photo.url) return <span className="point-photo-thumb is-loading"><LoaderCircle size={14} className="spin" aria-label={uiText('Загрузка фото…')} /></span>
  return <button type="button" className="point-photo-thumb" onClick={onOpen} title={uiText('Открыть фото')}><img src={photo.url} alt={uiText('Фото: где искать')} /></button>
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
