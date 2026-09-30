import { DEFAULT_SMOKE_OPTIONS, SMOKE_GREEN_HUE, SMOKE_SPEED, SMOKE_WIDTH, setRaidSmokeOptions, useRaidSmokeOptions } from '../app/raidSmokeSetting'
import { uiText } from '../i18n/renderText'
import '../styles/raidSmoke.css'

/** Settings → Интерфейс, under «Дым за боссами»: plume width, animation speed, colour, tone and gradient. */
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
  const changed = (Object.keys(DEFAULT_SMOKE_OPTIONS) as Array<keyof typeof DEFAULT_SMOKE_OPTIONS>).some((key) => options[key] !== DEFAULT_SMOKE_OPTIONS[key])
  const light = (hue: number) => `hsl(${hue} 80% ${Math.round(52 + options.tone * (options.tone > 0 ? 33 : 36))}%)`
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
        <output><i className="raid-smoke-dot" style={{ background: light(options.hue) }} /></output>
      </label>
      <label>
        <span>{uiText('Темнее — светлее')}</span>
        <input className="raid-smoke-tone" type="range" min={-1} max={1} step={0.05} value={options.tone} onChange={(event) => setRaidSmokeOptions({ tone: Number(event.target.value) })} style={{ background: `linear-gradient(90deg, hsl(${options.hue} 80% 16%), hsl(${options.hue} 80% 52%), hsl(${options.hue} 80% 85%))` }} aria-valuetext={`${Math.round(options.tone * 100)}%`} />
        <output>{options.tone > 0 ? '+' : ''}{Math.round(options.tone * 100)}</output>
      </label>
      <label className="raid-smoke-check">
        <span>{uiText('Градиент')}</span>
        <span>
          <input type="checkbox" checked={options.gradient} onChange={(event) => setRaidSmokeOptions({ gradient: event.target.checked })} />
          <small>{uiText('Дым меняет цвет по мере подъёма')}</small>
        </span>
        <output>{options.gradient && <i className="raid-smoke-dot is-gradient" style={{ background: `linear-gradient(0deg, ${light(options.hue)}, ${light(options.topHue)})` }} />}</output>
      </label>
      {options.gradient && (
        <label>
          <span>{uiText('Цвет верхушки')}</span>
          <input className="raid-smoke-hue" type="range" min={0} max={359} step={1} value={options.topHue} onChange={(event) => setRaidSmokeOptions({ topHue: Number(event.target.value) })} aria-valuetext={`${options.topHue}°`} />
          <output><i className="raid-smoke-dot" style={{ background: light(options.topHue) }} /></output>
        </label>
      )}
      <div className="raid-smoke-swatches">
        {SWATCHES.map((swatch) => (
          <button key={swatch.hue} type="button" className={options.hue === swatch.hue ? 'active' : ''} style={{ background: `hsl(${swatch.hue} 80% 52%)` }} title={uiText(swatch.label)} aria-label={uiText(swatch.label)} aria-pressed={options.hue === swatch.hue} onClick={() => setRaidSmokeOptions({ hue: swatch.hue })} />
        ))}
        <button type="button" className="button ghost raid-smoke-reset" disabled={!changed} onClick={() => setRaidSmokeOptions({})}>{uiText('Сбросить')}</button>
      </div>
    </div>
  )
}
