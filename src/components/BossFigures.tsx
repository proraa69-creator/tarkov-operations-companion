import { bossFiguresFor } from '../data/bossFigures'
import { useLocale } from '../i18n/LocaleProvider'

/** The bosses of the selected map standing on the right of the raid card (static stills, decorative). */
export function BossFigures({ mapId }: { mapId: string }) {
  const { locale } = useLocale()
  const figures = bossFiguresFor(mapId)
  if (!figures.length) return null
  return (
    <div className={`boss-figures count-${Math.min(figures.length, 3)}`} key={mapId}>
      {figures.map((figure, index) => (
        <figure key={figure.key} className="boss-figure" style={{ zIndex: figures.length - Math.abs(index - (figures.length - 1) / 2) * 2 }}>
          <img src={figure.url} alt="" draggable={false} />
          <figcaption>{locale === 'en' ? figure.name.en : figure.name.ru}</figcaption>
        </figure>
      ))}
    </div>
  )
}
