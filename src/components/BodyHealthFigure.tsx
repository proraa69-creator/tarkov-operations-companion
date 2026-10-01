import { uiText } from '../i18n/renderText'

/** Head, thorax, stomach, left arm, right arm, left leg, right leg (the game's order). */
export type BodyParts = readonly [number, number, number, number, number, number, number]

/** A PMC's health in Escape from Tarkov: 35 / 85 / 70 / 60 / 60 / 65 / 65 = 440 HP. */
const PMC_BODY: BodyParts = [35, 85, 70, 60, 60, 65, 65]

const BODY_PART_NAMES = ['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'] as const

interface Shape {
  /** SVG path of the part (viewBox 0 0 300 304; the figure stands in the middle, seen from behind as in the game). */
  d: string
  /** centre of the HP number */
  x: number
  y: number
  /** where the part's name goes: left or right column at this height with a short leader to `edge`, or inside the part */
  side: 'left' | 'right' | 'inside'
  labelY: number
  edge?: number
}

const SHAPES: Shape[] = [
  { d: 'M150 6c14 0 24 11 24 27s-10 29-24 29-24-13-24-29 10-27 24-27z', x: 150, y: 40, side: 'left', labelY: 30, edge: 124 },
  { d: 'M116 68h68c8 0 13 5 13 13v50H103V81c0-8 5-13 13-13z', x: 150, y: 109, side: 'inside', labelY: 88 },
  { d: 'M105 135h90v37c0 7-5 12-12 12h-66c-7 0-12-5-12-12z', x: 150, y: 168, side: 'inside', labelY: 150 },
  { d: 'M101 72H86c-10 0-16 6-17 16l-8 92c-1 8 3 13 11 13h16c6 0 9-4 10-10l3-43z', x: 84, y: 140, side: 'left', labelY: 62 },
  { d: 'M199 72h15c10 0 16 6 17 16l8 92c1 8-3 13-11 13h-16c-6 0-9-4-10-10l-3-43z', x: 216, y: 140, side: 'right', labelY: 62 },
  { d: 'M107 188h40v100c0 7-4 11-11 11h-19c-6 0-10-4-10-10z', x: 127, y: 246, side: 'left', labelY: 222, edge: 105 },
  { d: 'M153 188h40v101c0 6-4 10-10 10h-19c-7 0-11-4-11-11z', x: 173, y: 246, side: 'right', labelY: 222, edge: 195 },
]

/**
 * Tarkov-style health figure: the seven body parts with the HP on each and the total. `compare` (default: a PMC's
 * 440 HP) is shown small under every number, so a boss reads against an ordinary player. Colours come from the
 * theme tokens (bodyHealthFigure styles in bossInfoPanel.css); head and thorax — the lethal parts — in the danger tone.
 */
export function BodyHealthFigure({ body, compare = PMC_BODY, compareLabel = 'ЧВК', showTotal = true }: { body: BodyParts; compare?: BodyParts | null; compareLabel?: string; showTotal?: boolean }) {
  const max = Math.max(...body)
  const total = body.reduce((sum, value) => sum + value, 0)
  const compareTotal = compare ? compare.reduce((sum, value) => sum + value, 0) : 0
  return (
    <figure className="body-figure">
      <svg viewBox="0 0 300 304" role="img" aria-label={`${uiText('Здоровье')}: ${body.map((value, part) => `${uiText(BODY_PART_NAMES[part])} ${value}`).join(', ')}`}>
        {SHAPES.map((shape, part) => {
          const lethal = part < 2
          const strength = 0.25 + 0.6 * (body[part] / max)
          const inside = shape.side === 'inside'
          const labelX = inside ? shape.x : shape.side === 'left' ? 4 : 296
          const lineStart = shape.side === 'left' ? 66 : 234
          return (
            <g key={part} className={`body-figure-part${lethal ? ' is-lethal' : ''}`}>
              <title>{`${uiText(BODY_PART_NAMES[part])}: ${body[part]} HP`}</title>
              <path d={shape.d} style={{ fillOpacity: strength }} />
              {!inside && shape.edge != null && <line x1={lineStart} y1={shape.labelY + 4} x2={shape.edge} y2={shape.labelY + 4} className="body-figure-leader" />}
              <text x={labelX} y={shape.labelY} textAnchor={inside ? 'middle' : shape.side === 'left' ? 'start' : 'end'} className={`body-figure-name${inside ? ' is-inside' : ''}`}>{uiText(BODY_PART_NAMES[part])}</text>
              <text x={shape.x} y={shape.y} textAnchor="middle" className="body-figure-value">{body[part]}</text>
              {compare && <text x={shape.x} y={shape.y + 13} textAnchor="middle" className="body-figure-compare">{compare[part]}</text>}
            </g>
          )
        })}
      </svg>
      <figcaption>
        {showTotal && <span className="body-figure-total"><b>{total}</b> HP</span>}
        {compare && <span className="body-figure-ref"><i aria-hidden="true">{compare[0]}</i> {uiText('мелкие цифры')} — {uiText(compareLabel)}, {compareTotal} HP{total !== compareTotal ? ` · ${uiText('босс')} ×${(total / compareTotal).toFixed(1)}` : ''}</span>}
      </figcaption>
    </figure>
  )
}
