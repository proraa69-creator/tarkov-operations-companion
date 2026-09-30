import { useState } from 'react'
import { uiText } from '../../i18n/renderText'
import { ALCANTARA_STITCHES, currentStitch, saveStitch } from '../theme'

/** Settings → «Цветовая схема», shown while «Алькантара» is on: the thread colour of the seams (dark by default). */
export function StitchChooser() {
  const [stitch, setStitch] = useState(currentStitch)
  return (
    <div className="setting-row alc-stitch-row">
      <span>
        <strong>{uiText('Строчка')}</strong>
        <small>{uiText('Цвет ниток на швах')}</small>
      </span>
      <div className="alc-stitch-options" role="radiogroup" aria-label={uiText('Строчка')}>
        {ALCANTARA_STITCHES.map((option) => (
          <button
            key={option.id} type="button" role="radio" aria-checked={stitch === option.id} className="alc-stitch-option"
            onClick={() => { saveStitch(option.id); setStitch(option.id) }}
          >
            <span className="alc-stitch-swatch" style={{ '--swatch': option.swatch } as React.CSSProperties} />
            {uiText(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}
