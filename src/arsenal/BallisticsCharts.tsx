import { useMemo, useState } from 'react'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'
import type { AmmoStats } from './ammoSource'
import { caliberLabel, damageText } from './ammoSource'
import { placeLabels } from './caliberColors'
import { ARMOR_CLASSES, armorEffectiveness, armorResistance, effectiveArmorClass } from './ballistics'
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
        {uiText('Правило: пробитие ≥ класс × 10 — класс пробивается уверенно. Шанс считается при постоянной прочности; износ брони между выстрелами не учитывается.')}
      </p>
    </div>
  )
}
