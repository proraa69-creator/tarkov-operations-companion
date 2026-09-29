import type React from 'react'
import { bossFiguresFor } from '../data/bossFigures'
import { useLocale } from '../i18n/LocaleProvider'

/**
 * The bosses of the selected map standing on the right of the raid card (static stills, decorative).
 * Each still is sized by its height in body heights, so every boss is the same size per body (a raised rifle
 * or antlers just stick up further) — never squeezed to fit its slot's width.
 */
export function BossFigures({ mapId }: { mapId: string }) {
  const { locale } = useLocale()
  const figures = bossFiguresFor(mapId)
  if (!figures.length) return null
  return (
    <div className={`boss-figures${figures.length >= 5 ? ' is-crowded' : ''}`} style={{ '--n': figures.length } as React.CSSProperties} key={mapId}>
      {figures.map((figure, index) => (
        <figure key={figure.key} className="boss-figure" style={{ zIndex: figures.length - Math.abs(index - (figures.length - 1) / 2) * 2, '--fig-h': figure.height } as React.CSSProperties}>
          <img src={figure.url} alt={locale === 'en' ? figure.name.en : figure.name.ru} title={locale === 'en' ? figure.name.en : figure.name.ru} draggable={false} />
        </figure>
      ))}
    </div>
  )
}
