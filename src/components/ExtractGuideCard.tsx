import { useState } from 'react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { extractPhotoUrl, type ExtractGuide } from '../data/extractGuide'
import { ImageViewer } from './ImageViewer'

/**
 * An exit's card on the map: where it is, what it asks for and its photos; a click enlarges a photo, the arrows go through
 * them and a second click closes it. No source line (owner, 04.11.2026: «Источники где взяли не пиши»).
 */
export function ExtractGuideCard({ guide }: { guide: ExtractGuide }) {
  const { locale } = useLocale()
  const [open, setOpen] = useState<number | null>(null)
  const photos = guide.photos ?? []
  return <>
    <p className="extract-guide-text">{locale === 'en' ? guide.en : guide.ru}</p>
    {photos.length > 0 && <div className="extract-guide-photos" role="list">
      {photos.map((id, index) => <button key={id} type="button" role="listitem" className="extract-guide-photo" title={uiText('Фото места')} aria-label={uiText('Фото места')} onClick={() => setOpen(index)}>
        <img src={extractPhotoUrl(id, true)} alt={uiText('Фото места')} loading="lazy" decoding="async" />
      </button>)}
    </div>}
    {open !== null && <ImageViewer images={photos.map((id) => extractPhotoUrl(id, false))} index={open} onIndex={setOpen} onClose={() => setOpen(null)} closeOnClick />}
  </>
}
