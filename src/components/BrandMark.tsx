import { useId } from 'react'
import iconUrl from '../assets/brand-icon.webp'
import '../styles/brand.css'

// «Raid OS» monogram (build/brand/mark.svg): an R whose leg is olive. The R takes the tile's text colour from the
// theme, so every colour scheme keeps its own logo tile; the leg is --brand-leg (olive unless a theme overrides it).
const R_PATH = 'M115.8 194L80 194L80 32L124.6 32Q141 32 153 35.6Q165 39.2 171.7 48.5Q178.4 57.8 178.4 74.8Q178.4 84.8 176.8 92.6Q175.2 100.4 170.9 106.1Q166.6 111.8 158.6 115.6L180.8 194L143.8 194L126 121.4L115.8 121.4L115.8 194ZM115.8 56L115.8 100.8L125.8 100.8Q133.4 100.8 137.6 98.1Q141.8 95.4 143.5 90.3Q145.2 85.2 145.2 78Q145.2 67.6 141.4 61.8Q137.6 56 127.4 56L115.8 56Z'
const LEG = 'M113.6 117.86L208 117.86L208 204L130.4 204Z'

export function BrandMonogram() {
  const id = useId().replace(/:/g, '')
  return (
    <svg className="brand-monogram" viewBox="72 28 116 170" aria-hidden="true" focusable="false">
      <clipPath id={`${id}-body`}><path d={`M0 0H256V256H0Z${LEG}`} clipRule="evenodd" /></clipPath>
      <clipPath id={`${id}-leg`}><path d={LEG} /></clipPath>
      <path d={R_PATH} fill="currentColor" clipPath={`url(#${id}-body)`} />
      <path d={R_PATH} className="brand-monogram-leg" clipPath={`url(#${id}-leg)`} />
    </svg>
  )
}

/** The app's emblem: the Raid OS icon of the exe and the desktop shortcut (build/icon.png), the same in every theme. */
export function BrandEmblem() {
  return <div className="brand-mark brand-mark-image"><img src={iconUrl} alt="" draggable={false} /></div>
}

/** Sidebar logo: emblem + «RAID OS» + «полевой компаньон». */
export function BrandName({ locale }: { locale: string }) {
  return (
    <div className="brand-name">
      RAID <span className="brand-os">OS</span>
      <span className="brand-sub">{locale === 'en' ? 'FIELD COMPANION' : 'ПОЛЕВОЙ КОМПАНЬОН'}</span>
    </div>
  )
}
