import { DEFAULT_SMOKE_OPTIONS, SMOKE_GREEN_HUE, SMOKE_SPEED, SMOKE_WIDTH, setRaidSmokeOptions, useRaidSmokeOptions } from '../app/raidSmokeSetting'
import { uiText } from '../i18n/renderText'
import '../styles/raidSmoke.css'

/** Settings → Интерфейс, under «Дым за боссами»: plume width, animation speed and colour. */
const SWATCHES: Array<{ hue: number; label: string }> = [
  { hue: SMOKE_GREEN_HUE, label: 'Зелёный' },
  { hue: 0, label: 'Красный' },
  { hue: 30, label: 'Оранжевый' },
  { hue: 55, label: 'Жёлтый' },
  { hue: 195, label: 'Голубой' },
  { hue: 280, label: 'Фиолетовый' },
]

const times = (value: number) => `×${value.toFixed(2).replace(/\.?0+$/, '')}`

export function RaidSmokeSettings() {
  const options = useRaidSmokeOptions()
  const changed = options.width !== DEFAULT_SMOKE_OPTIONS.width || options.speed !== DEFAULT_SMOKE_OPTIONS.speed || options.hue !== DEFAULT_SMOKE_OPTIONS.hue
  return (
    <div className="raid-smoke-settings">
      <label>
        <span>{uiText('Ширина факела')}</span>
        <input type="range" min={SMOKE_WIDTH.min} max={SMOKE_WIDTH.max} step={0.05} value={options.width} onChange={(event) => setRaidSmokeOptions({ width: Number(event.target.value) })} aria-valuetext={times(options.width)} />
        <output>{times(options.width)}</output>
      </label>
      <label>
        <span>{uiText('Скорость анимации')}</span>
        <input type="range" min={SMOKE_SPEED.min} max={SMOKE_SPEED.max} step={0.05} value={options.speed} onChange={(event) => setRaidSmokeOptions({ speed: Number(event.target.value) })} aria-valuetext={times(options.speed)} />
        <output>{times(options.speed)}</output>
      </label>
      <label>
        <span>{uiText('Цвет факела')}</span>
        <input className="raid-smoke-hue" type="range" min={0} max={359} step={1} value={options.hue} onChange={(event) => setRaidSmokeOptions({ hue: Number(event.target.value) })} aria-valuetext={`${options.hue}°`} />
        <output><i className="raid-smoke-dot" style={{ background: `hsl(${options.hue} 80% 52%)` }} /></output>
      </label>
      <div className="raid-smoke-swatches">
        {SWATCHES.map((swatch) => (
          <button key={swatch.hue} type="button" className={options.hue === swatch.hue ? 'active' : ''} style={{ background: `hsl(${swatch.hue} 80% 52%)` }} title={uiText(swatch.label)} aria-label={uiText(swatch.label)} aria-pressed={options.hue === swatch.hue} onClick={() => setRaidSmokeOptions({ hue: swatch.hue })} />
        ))}
        <button type="button" className="button ghost raid-smoke-reset" disabled={!changed} onClick={() => setRaidSmokeOptions({})}>{uiText('Сбросить')}</button>
      </div>
    </div>
  )
}
