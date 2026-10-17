import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { AmmoStats } from './ammoSource'
import { caliberLabel } from './ammoSource'
import { CM_PER_INCH, hasBallistics, zeroedTrajectory, type TrajectoryPoint } from './ballistics'
import './arsenal.css'

/**
 * «Падение пули» on «Баллистика» (owner, 17.10.2026: «возьми от туда баллистику патронов… таблицы падения пули, адаптируй
 * под наш дизайн»): up to four rounds on one chart of drop against distance, zeroed at 50–200 m, and the table of the
 * chosen round every 50 m — drop, time of flight, speed, damage and penetration. The game's G1 solver
 * (src/arsenal/ballistics.ts); the round's own initial speed, a weapon's barrel and muzzle change it in «Сборка оружия».
 */

const ZERO_DISTANCES = [50, 100, 150, 200] as const
const MAX_ROUNDS = 4
const MAX_DISTANCE = 600
const TABLE_DISTANCES = Array.from({ length: MAX_DISTANCE / 50 }, (_, index) => (index + 1) * 50)
/** Dash patterns that tell rounds of one calibre (one colour) apart. */
const DASHES = ['', '7 4', '2 3', '10 3 2 3']

type Unit = 'cm' | 'in'

/** The rounds shown at first: the selected one and, of its calibre, the one that penetrates most. */
function defaultDropRounds(ammo: AmmoStats[], selected?: AmmoStats): string[] {
  if (!selected || !hasBallistics(selected)) return []
  const best = ammo.filter((round) => round.caliber === selected.caliber && round.id !== selected.id && hasBallistics(round))
    .sort((a, b) => b.penetration - a.penetration)[0]
  return best ? [selected.id, best.id] : [selected.id]
}

interface Series { round: AmmoStats; color: string; dash: string; points: TrajectoryPoint[] }

export function BulletDropPanel({ ammo, selected, colorOf }: { ammo: AmmoStats[]; selected?: AmmoStats; colorOf: (caliber: string) => string }) {
  const [picked, setPicked] = useState<string[] | null>(null)
  const [activeId, setActiveId] = useState<string>()
  const [zero, setZero] = useState<number>(100)
  const [unit, setUnit] = useState<Unit>('cm')
  const withData = useMemo(() => ammo.filter((round) => hasBallistics(round)), [ammo])
  const ids = (picked ?? defaultDropRounds(ammo, selected)).filter((id) => withData.some((round) => round.id === id))
  // Four trajectories of ~600 steps each: cheap enough to work out on every render.
  const seen = new Map<string, number>()
  const series: Series[] = ids.flatMap((id) => {
    const round = withData.find((entry) => entry.id === id)
    if (!round || !hasBallistics(round)) return []
    const index = seen.get(round.caliber) ?? 0
    seen.set(round.caliber, index + 1)
    return [{ round, color: colorOf(round.caliber), dash: DASHES[index % DASHES.length]!, points: zeroedTrajectory(round, zero, MAX_DISTANCE) }]
  })
  const active = series.find((entry) => entry.round.id === activeId) ?? series[0]
  const setIds = (next: string[]) => setPicked(next.slice(0, MAX_ROUNDS))
  const options = useMemo(() => {
    const base = selected?.caliber
    return [...withData].sort((a, b) => Number(b.caliber === base) - Number(a.caliber === base) || a.caliber.localeCompare(b.caliber) || b.penetration - a.penetration)
  }, [withData, selected?.caliber])

  if (!withData.length) {
    return <p className="chart-note">{uiText('Для расчёта падения нужны масса, диаметр пули и баллистический коэффициент — в этих данных их нет. Они появятся с живыми данными игры.')}</p>
  }

  const length = (cm: number) => unit === 'cm' ? cm : cm / CM_PER_INCH
  return <div className="bullet-drop">
    <div className="bullet-drop-controls">
      <div className="bullet-drop-rounds">
        {series.map((entry) => <span key={entry.round.id} className={`bullet-drop-chip${entry === active ? ' is-active' : ''}`}>
          <button type="button" className="bullet-drop-chip-main" onClick={() => setActiveId(entry.round.id)} aria-pressed={entry === active}>
            <svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={entry.color} strokeWidth="2.5" strokeDasharray={entry.dash} /></svg>
            {entry.round.shortName}
          </button>
          <button type="button" className="bullet-drop-chip-remove" aria-label={`${uiText('Убрать')} ${entry.round.shortName}`} onClick={() => setIds(ids.filter((id) => id !== entry.round.id))}><X size={12} /></button>
        </span>)}
        {ids.length < MAX_ROUNDS && <select className="select bullet-drop-add" aria-label={uiText('Добавить патрон')} value="" onChange={(event) => { if (event.target.value) setIds([...ids, event.target.value]) }}>
          <option value="">{uiText('+ Патрон для сравнения')}</option>
          {options.filter((round) => !ids.includes(round.id)).map((round) => <option key={round.id} value={round.id}>{caliberLabel(round.caliber)} · {round.shortName}</option>)}
        </select>}
      </div>
      <div className="segmented-filter" role="radiogroup" aria-label={uiText('Пристрелка')}>
        {ZERO_DISTANCES.map((distance) => <button key={distance} type="button" role="radio" aria-checked={zero === distance} className={zero === distance ? 'active' : ''} onClick={() => setZero(distance)}>{distance} {uiText('м')}</button>)}
      </div>
      <div className="segmented-filter" role="radiogroup" aria-label={uiText('Единицы')}>
        <button type="button" role="radio" aria-checked={unit === 'cm'} className={unit === 'cm' ? 'active' : ''} onClick={() => setUnit('cm')}>{uiText('см')}</button>
        <button type="button" role="radio" aria-checked={unit === 'in'} className={unit === 'in' ? 'active' : ''} onClick={() => setUnit('in')}>{uiText('дюймы')}</button>
      </div>
    </div>
    {series.length > 0 && <DropChart series={series} zero={zero} unit={unit} />}
    {active && <div className="dropoff-table-wrap">
      <table className="price-table dropoff-table">
        <caption className="bullet-drop-caption">{active.round.shortName} · {uiText('пристрелка')} {zero} {uiText('м')} · {Math.round(active.round.initialSpeed ?? 0)} {uiText('м/с')}</caption>
        <thead><tr>
          <th>{uiText('Дистанция')}</th><th>{uiText('Падение')}, {uiText(unit === 'cm' ? 'см' : 'дюймы')}</th><th>{uiText('Время')}, {uiText('с')}</th><th>{uiText('Скорость')}, {uiText('м/с')}</th><th>{uiText('Урон')}</th><th>{uiText('Пробитие')}</th>
        </tr></thead>
        <tbody>
          {TABLE_DISTANCES.map((distance) => {
            const point = active.points.find((entry) => entry.distance === distance)
            if (!point) return null
            return <tr key={distance} className={distance === zero ? 'is-zero' : undefined}>
              <td className="mono">{distance} {uiText('м')}</td>
              <td className={`mono${point.drop < -0.5 ? ' drop-low' : point.drop > 0.5 ? ' drop-high' : ''}`}>{length(point.drop) > 0 ? '+' : ''}{length(point.drop).toFixed(1)}</td>
              <td className="mono">{point.time.toFixed(3)}</td>
              <td className="mono">{Math.round(point.speed)}</td>
              <td className="mono">{point.damage.toFixed(1)}</td>
              <td className="mono">{point.penetration.toFixed(1)}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>}
    <p className="chart-note">{uiText('Расчёт по модели игры: сопротивление G1 по массе, диаметру и баллистическому коэффициенту пули, шаг 0,01 с; линия прицеливания на 6,86 см выше ствола. Урон и пробитие падают до половины вместе со скоростью. Начальная скорость — из данных патрона; ствол и дульное устройство меняют её в «Сборке оружия».')}</p>
  </div>
}

const W = 720
const H = 260
const M = { left: 48, right: 14, top: 14, bottom: 30 }

/** Drop curves against distance, the line of sight at 0, the zero distance marked; hover shows every round's drop. */
function DropChart({ series, zero, unit }: { series: Series[]; zero: number; unit: Unit }) {
  const [hover, setHover] = useState<number>()
  const factor = unit === 'cm' ? 1 : 1 / CM_PER_INCH
  const lows = series.flatMap((entry) => entry.points.map((point) => point.drop * factor))
  const yMin = niceFloor(Math.min(-10 * factor, ...lows))
  const yMax = niceCeil(Math.max(5 * factor, ...lows))
  const x = (distance: number) => M.left + (distance / MAX_DISTANCE) * (W - M.left - M.right)
  const y = (value: number) => M.top + ((yMax - value) / (yMax - yMin)) * (H - M.top - M.bottom)
  const ticks = niceTicks(yMin, yMax)
  const hoverDistance = hover === undefined ? undefined : Math.round(hover / 10) * 10
  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHover(Math.max(0, Math.min(MAX_DISTANCE, ((event.clientX - rect.left) / rect.width) * MAX_DISTANCE)))
  }
  return <figure className="mini-line bullet-drop-chart">
    <figcaption>{uiText('Падение пули')}, {uiText(unit === 'cm' ? 'см' : 'дюймы')}</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={uiText('Падение пули по дистанции')}>
      {ticks.map((tick) => <g key={tick} className="axis-tick">
        <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} />
        <text x={M.left - 6} y={y(tick) + 4} textAnchor="end">{Math.round(tick)}</text>
      </g>)}
      <line className="bullet-drop-sight" x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} />
      <g className="armor-guide"><line x1={x(zero)} x2={x(zero)} y1={M.top} y2={H - M.bottom} /><text x={x(zero) + 4} y={M.top + 10}>{uiText('пристрелка')} {zero} {uiText('м')}</text></g>
      {[0, 100, 200, 300, 400, 500, 600].map((distance) => <text key={distance} className="axis-label" x={x(distance)} y={H - M.bottom + 16} textAnchor="middle">{distance} {uiText('м')}</text>)}
      {series.map((entry) => <path key={entry.round.id} d={entry.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.distance).toFixed(1)},${y(point.drop * factor).toFixed(1)}`).join(' ')} fill="none" stroke={entry.color} strokeWidth={2.2} strokeDasharray={entry.dash} strokeLinejoin="round" />)}
      {hoverDistance !== undefined && <g className="crosshair">
        <line x1={x(hoverDistance)} x2={x(hoverDistance)} y1={M.top} y2={H - M.bottom} />
        {series.map((entry, index) => {
          const point = entry.points.find((candidate) => candidate.distance === hoverDistance)
          if (!point) return null
          const value = point.drop * factor
          return <g key={entry.round.id}>
            <circle cx={x(hoverDistance)} cy={y(value)} r={3.5} fill={entry.color} />
            <text x={Math.min(x(hoverDistance) + 8, W - 170)} y={M.top + 26 + index * 14}>{`${entry.round.shortName}: ${value > 0 ? '+' : ''}${value.toFixed(1)}`}</text>
          </g>
        })}
        <text x={Math.min(x(hoverDistance) + 8, W - 170)} y={M.top + 12}>{hoverDistance} {uiText('м')}</text>
      </g>}
      <rect className="hover-capture" x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} />
    </svg>
  </figure>
}

function step(span: number) {
  const raw = span / 5
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  return [1, 2, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= raw) ?? raw
}

function niceFloor(value: number) {
  const s = step(Math.abs(value))
  return Math.floor(value / s) * s
}

function niceCeil(value: number) {
  const s = step(Math.max(Math.abs(value), 1))
  return Math.ceil(value / s) * s
}

function niceTicks(min: number, max: number) {
  const s = step(max - min)
  const ticks: number[] = []
  for (let value = Math.ceil(min / s) * s; value <= max + 1e-9; value += s) ticks.push(Math.round(value * 1000) / 1000)
  return ticks
}
