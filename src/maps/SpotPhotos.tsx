import { useMemo, useState } from 'react'
import { ImageViewer } from '../components/ImageViewer'
import { useLocale } from '../i18n/LocaleProvider'
import '../components/battlePassDocuments.css'

/** The pictures of src/assets/key-spots by file name (the markers name them, src/data/extraKeySpots.ts). */
const FILES = import.meta.glob('../assets/key-spots/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const pictureOf = (file: string) => FILES[`../assets/key-spots/${file}`]

/** Photos of a point's place (src/data/extraKeySpots.ts) under its title, as the documents' ones: a click enlarges. */
export function SpotPhotos({ photos: listed }: { photos: ReadonlyArray<{ file: string; ru: string; en: string }> }) {
  const { locale } = useLocale()
  const [open, setOpen] = useState<number | null>(null)
  const photos = useMemo(() => listed.flatMap((photo) => { const src = pictureOf(photo.file); return src ? [{ ...photo, src }] : [] }), [listed])
  const images = useMemo(() => photos.map((photo) => photo.src), [photos])
  if (!photos.length) return null
  return <>
    <div className="document-photos" role="list">
      {photos.map((photo, index) => {
        const caption = locale === 'en' ? photo.en : photo.ru
        return (
          <button key={photo.src} type="button" role="listitem" className="document-photo" title={caption} onClick={() => setOpen(index)}>
            <img src={photo.src} alt={caption} loading="lazy" decoding="async" />
            <span>{caption}</span>
          </button>
        )
      })}
    </div>
    {open !== null && <ImageViewer images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} closeOnClick />}
  </>
}
