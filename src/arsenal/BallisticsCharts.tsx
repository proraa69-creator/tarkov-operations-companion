import { useMemo, useState } from 'react'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'
import type { AmmoStats } from './ammoSource'
import { caliberLabel, damageText } from './ammoSource'
import { placeLabels } from './caliberColors'
import { ARMOR_CLASSES, armorEffectiveness, armorResistance, dropOffCurve, effectiveArmorClass } from './ballistics'
import './arsenal.css'

const percent = (value: number | undefined, digits = 0) => (value === undefined ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`)
const plain = (value: number | undefined, suffix = '') => (value === undefined ? '—' : `${Math.round(value)}${suffix}`)

function niceMax(value: number, step: number) {
  return Math.max(step, Math.ceil(value / step) * step)
}

const W = 920
const H = 460
const M = { left: 48, right: 16, top: 30, bottom: 40 }

interface ScatterProps {
  ammo: AmmoStats[]
  colorOf: (caliber: string) => string
  selectedId?: string
  onSelect: (id: string) => void
}

/** Penetration (x) vs damage (y) with armor-class bands; each round labelled by its short name where room allows. */
export function AmmoScatter({ ammo, colorOf, selectedId, onSelect }: ScatterProps) {
  const [hoverId, setHoverId] = useState<string>()
  const xMax = niceMax(Math.max(70, ...ammo.map((round) => round.penetration + 4)), 10)
  const yMax = niceMax(Math.max(80, ...ammo.map((round) => round.damage + 8)), 20)
  const x = (value: number) => M.left + (value / xMax) * (W - M.left - M.right)
  const y = (value: number) => H - M.bottom - (value / yMax) * (H - M.top - M.bottom)
  const yTicks = Array.from({ length: yMax / 20 + 1 }, (_, index) => index * 20).filter((tick) => yMax <= 160 || tick % 40 === 0)
  const xTicks = Array.from({ length: xMax / 10 + 1 }, (_, index) => index * 10)
  const labels = useMemo(() => placeLabels(
    [...ammo].sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : b.penetration + b.damage - a.penetration - a.damage)).map((round) => {
      const width = round.shortName.length * 6.4 + 4
      const cx = x(round.penetration)
      const cy = y(round.damage)
      return { round, box: { x: cx + 6, y: cy - 16, width, height: 12 } }
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [ammo, selectedId, xMax, yMax])
  const hovered = ammo.find((round) => round.id === hoverId)

  return (
    <div className="ballistics-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={uiText('Пробитие и урон боеприпасов')}>
        {ARMOR_CLASSES.map((armorClass) => {
          const from = armorResistance(armorClass)
          const to = Math.min(xMax, from + 10)
          if (from >= xMax) return null
          return (
            <g key={armorClass} className={`armor-band band-${armorClass % 2 ? 'odd' : 'even'}`}>
              <rect x={x(from)} y={M.top} width={x(to) - x(from)} height={H - M.top - M.bottom} />
              <text x={(x(from) + x(to)) / 2} y={M.top - 10} textAnchor="middle">{`${uiText('Класс')} ${armorClass}`}</text>
              {armorClass >= 3 && <line className="armor-threshold" x1={x(from)} x2={x(from)} y1={M.top} y2={H - M.bottom} />}
            </g>
          )
        })}
        {yTicks.map((tick) => (
          <g key={`y${tick}`} className="axis-tick">
            <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} />
            <text x={M.left - 8} y={y(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={`x${tick}`} className="axis-label" x={x(tick)} y={H - M.bottom + 18} textAnchor="middle">{tick}</text>
        ))}
        <text className="axis-title" x={W - M.right} y={H - 6} textAnchor="end">{uiText('Пробитие')} →</text>
        <text className="axis-title" x={12} y={M.top + 4} transform={`rotate(-90 12 ${M.top + 4})`} textAnchor="end">{uiText('Урон')} →</text>
        {ammo.map((round) => (
          <circle
            key={round.id}
            className={`ammo-dot${round.id === selectedId ? ' selected' : ''}${round.id === hoverId ? ' hovered' : ''}`}
            cx={x(round.penetration)}
            cy={y(round.damage)}
            r={round.id === selectedId ? 7 : 5}
            fill={colorOf(round.caliber)}
          />
        ))}
        {labels.map(({ round, box }) => (
          <text key={`l${round.id}`} className={`ammo-label${round.id === selectedId ? ' selected' : ''}`} x={box.x} y={box.y + 10}>{round.shortName}</text>
        ))}
        {ammo.map((round) => (
          <circle
            key={`hit${round.id}`}
            className="ammo-hit"
            cx={x(round.penetration)}
            cy={y(round.damage)}
            r={11}
            tabIndex={0}
            aria-label={`${round.shortName}: ${uiText('урон')} ${damageText(round)}, ${uiText('пробитие')} ${round.penetration}`}
            onMouseEnter={() => setHoverId(round.id)}
            onMouseLeave={() => setHoverId((current) => (current === round.id ? undefined : current))}
            onFocus={() => setHoverId(round.id)}
            onBlur={() => setHoverId(undefined)}
            onClick={() => onSelect(round.id)}
          />
        ))}
      </svg>
      {hovered && (
        <AmmoTooltip
          ammo={hovered}
          color={colorOf(hovered.caliber)}
          left={(x(hovered.penetration) / W) * 100}
          top={(y(hovered.damage) / H) * 100}
        />
      )}
    </div>
  )
}

function AmmoTooltip({ ammo, color, left, top }: { ammo: AmmoStats; color: string; left: number; top: number }) {
  const flip = left > 62
  const below = top < 35
  const rows: Array<[string, string]> = [
    ['Урон', damageText(ammo)],
    ['Пробитие', String(ammo.penetration)],
    ['Урон броне', plain(ammo.armorDamage, '%')],
    ['Шанс фрагментации', ammo.fragmentationChance === undefined ? '—' : `${Math.round(ammo.fragmentationChance * 100)}%`],
    ['Начальная скорость', plain(ammo.initialSpeed, ` ${uiText('м/с')}`)],
    ['Отдача', percent(ammo.recoilModifier)],
    ['Точность', percent(ammo.accuracyModifier)],
    ['Цена', ammo.price ? formatPrice(ammo.price) : '—'],
  ]
  return (
    <div
      className="ammo-tooltip"
      role="tooltip"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: `translate(${flip ? 'calc(-100% - 14px)' : '14px'}, ${below ? '10px' : 'calc(-100% - 10px)'})`,
      }}
    >
      <div className="ammo-tooltip-head">
        <span className="swatch" style={{ background: color }} />
        <strong>{ammo.shortName}</strong>
        <small>{caliberLabel(ammo.caliber)}</small>
      </div>
      <div className="ammo-tooltip-name">{ammo.name}</div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}><dt>{uiText(label)}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {ammo.priceSource && <small className="dim">{uiText(ammo.priceSource)}</small>}
    </div>
  )
}

interface LegendProps {
  calibers: string[]
  colorOf: (caliber: string) => string
  active: string
  onPick: (caliber: string) => void
}

/** Caliber legend; a chip doubles as the filter. */
export function CaliberLegend({ calibers, colorOf, active, onPick }: LegendProps) {
  return (
    <div className="caliber-legend" role="group" aria-label={uiText('Калибры')}>
      {calibers.map((caliber) => (
        <button
          key={caliber}
          type="button"
          className={`caliber-chip${active === caliber ? ' active' : ''}`}
          aria-pressed={active === caliber}
          onClick={() => onPick(active === caliber ? '' : caliber)}
        >
          <span className="swatch" style={{ background: colorOf(caliber) }} />
          {caliberLabel(caliber)}
        </button>
      ))}
    </div>
  )
}

const DURABILITY_STEPS = [100, 80, 60, 40]

/** Penetration chance and shots-to-penetrate for classes 1–6 at the chosen armor durability. */
export function ArmorEffectivenessTable({ ammo }: { ammo: AmmoStats }) {
  const [durability, setDurability] = useState(100)
  const rows = armorEffectiveness(ammo.penetration, durability)
  const ruleClass = effectiveArmorClass(ammo.penetration)
  const shots = (value: number) => (Number.isFinite(value) ? (value < 10 ? value.toFixed(1) : String(Math.round(value))) : '∞')
  return (
    <div className="armor-table">
      <div className="armor-table-controls">
        <span className="stat-label">{uiText('Прочность брони')}</span>
        <div className="mode-switch">
          {DURABILITY_STEPS.map((step) => (
            <button key={step} type="button" className={durability === step ? 'active' : ''} onClick={() => setDurability(step)}>{step}%</button>
          ))}
        </div>
      </div>
      <table className="price-table">
        <thead>
          <tr>
            <th>{uiText('Класс')}</th>
            <th>{uiText('Шанс пробития')}</th>
            <th>{uiText('Выстрелов в среднем')}</th>
            <th>{uiText('Выстрелов для 90%')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.armorClass} className={row.armorClass <= ruleClass ? 'armor-beaten' : ''}>
              <td><strong>{row.armorClass}</strong> <small className="dim">({armorResistance(row.armorClass)})</small></td>
              <td>
                <div className="chance-bar" aria-hidden="true"><span style={{ width: `${row.chance * 100}%` }} /></div>
                <span className="mono">{Math.round(row.chance * 100)}%</span>
              </td>
              <td className="mono">{shots(row.expectedShots)}</td>
              <td className="mono">{Number.isFinite(row.shotsFor90) ? row.shotsFor90 : '∞'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="chart-note">
        {uiText('Правило вики: пробитие ≥ класс × 10 — класс пробивается уверенно. Шанс считается по формуле страницы «Ballistics» Escape from Tarkov Wiki при постоянной прочности; износ брони между выстрелами не учитывается.')}{' '}
        <a href="https://escapefromtarkov.fandom.com/wiki/Ballistics" target="_blank" rel="noreferrer">{uiText('Источник')}</a>
      </p>
    </div>
  )
}

const DW = 440
const DH = 220
const DM = { left: 40, right: 12, top: 14, bottom: 30 }
const MAX_DISTANCE = 600

/** Approximate damage and penetration over distance: two small charts sharing the distance axis (never a dual axis). */
export function DropOffCharts({ ammo, color }: { ammo: AmmoStats; color: string }) {
  const curve = dropOffCurve(ammo, MAX_DISTANCE, 25)
  const hasModel = Boolean(ammo.initialSpeed && ammo.ballisticCoefficient)
  const at = (distance: number) => curve.find((point) => point.distance === distance)
  return (
    <div className="dropoff">
      <div className="dropoff-grid">
        <MiniLine title={uiText('Урон')} values={curve.map((point) => [point.distance, point.damage])} color={color} yMax={niceMax(ammo.damage * 1.05, 10)} />
        <MiniLine
          title={uiText('Пробитие')}
          values={curve.map((point) => [point.distance, point.penetration])}
          color={color}
          yMax={niceMax(Math.max(ammo.penetration * 1.05, 40), 10)}
          guides={ARMOR_CLASSES.filter((armorClass) => armorClass >= 3).map((armorClass) => [armorResistance(armorClass), `${uiText('Класс')} ${armorClass}`])}
        />
      </div>
      <table className="price-table dropoff-table">
        <thead><tr><th>{uiText('Дистанция')}</th><th>{uiText('Скорость')}</th><th>{uiText('Урон')}</th><th>{uiText('Пробитие')}</th></tr></thead>
        <tbody>
          {[0, 100, 200, 300, 400, 500, 600].map((distance) => {
            const point = at(distance)
            return point ? (
              <tr key={distance}>
                <td className="mono">{distance} {uiText('м')}</td>
                <td className="mono">{point.speed ? `${Math.round(point.speed)} ${uiText('м/с')}` : '—'}</td>
                <td className="mono">{point.damage.toFixed(1)}</td>
                <td className="mono">{point.penetration.toFixed(1)}</td>
              </tr>
            ) : null
          })}
        </tbody>
      </table>
      <p className="chart-note">
        {uiText(hasModel
          ? 'Приблизительно. Скорость падает по простой модели сопротивления воздуха v = v0·e^(−k·x), k = ρ·Cd / (2·BC·703), ρ = 1,225 кг/м³, Cd = 0,3; урон и пробитие пропорциональны скорости. Начальная скорость и баллистический коэффициент — tarkov.dev; длина ствола не учитывается.'
          : 'Для этого патрона нет начальной скорости или баллистического коэффициента — падение не рассчитано.')}
      </p>
    </div>
  )
}

function MiniLine({ title, values, color, yMax, guides = [] }: { title: string; values: Array<[number, number]>; color: string; yMax: number; guides?: Array<[number, string]> }) {
  const [hover, setHover] = useState<number>()
  const x = (distance: number) => DM.left + (distance / MAX_DISTANCE) * (DW - DM.left - DM.right)
  const y = (value: number) => DH - DM.bottom - (Math.min(value, yMax) / yMax) * (DH - DM.top - DM.bottom)
  const path = values.map(([distance, value], index) => `${index ? 'L' : 'M'}${x(distance).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const ticks = [0, yMax / 2, yMax]
  const point = hover === undefined ? undefined : values[hover]
  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1)))))
  }
  return (
    <figure className="mini-line">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${DW} ${DH}`} role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick} className="axis-tick">
            <line x1={DM.left} x2={DW - DM.right} y1={y(tick)} y2={y(tick)} />
            <text x={DM.left - 6} y={y(tick) + 4} textAnchor="end">{Math.round(tick)}</text>
          </g>
        ))}
        {guides.filter(([value]) => value <= yMax).map(([value, label]) => (
          <g key={label} className="armor-guide">
            <line x1={DM.left} x2={DW - DM.right} y1={y(value)} y2={y(value)} />
            <text x={DW - DM.right - 2} y={y(value) - 3} textAnchor="end">{label}</text>
          </g>
        ))}
        {[0, 200, 400, 600].map((distance) => (
          <text key={distance} className="axis-label" x={x(distance)} y={DH - DM.bottom + 16} textAnchor="middle">{distance} {uiText('м')}</text>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {point && (
          <g className="crosshair">
            <line x1={x(point[0])} x2={x(point[0])} y1={DM.top} y2={DH - DM.bottom} />
            <circle cx={x(point[0])} cy={y(point[1])} r={4} fill={color} />
            <text x={Math.min(x(point[0]) + 6, DW - 90)} y={DM.top + 12}>{`${point[0]} ${uiText('м')}: ${point[1].toFixed(1)}`}</text>
          </g>
        )}
        <rect className="hover-capture" x={DM.left} y={DM.top} width={DW - DM.left - DM.right} height={DH - DM.top - DM.bottom} onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} />
      </svg>
    </figure>
  )
}
