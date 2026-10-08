import { useId } from 'react'
import { uiText } from '../i18n/renderText'

/** Head, thorax, stomach, left arm, right arm, left leg, right leg (the game's order). */
export type BodyParts = readonly [number, number, number, number, number, number, number]

const BODY_PART_NAMES = ['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'] as const

const TAG_W = 118
const TAG_H = 32
/**
 * Where each part's tag sits (top-left, viewBox 0 0 440 520), as on the game's health screen: the figure is seen from
 * behind, so the right arm and leg are on the left of the screen; thorax and stomach sit on the body.
 */
const TAGS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 262, y: 26 },
  { x: 161, y: 124 },
  { x: 161, y: 206 },
  { x: 314, y: 196 },
  { x: 8, y: 196 },
  { x: 282, y: 338 },
  { x: 40, y: 338 },
]

const LIMBS = [
  'M178 112 L152 172 L136 248 L122 300',
  'M262 112 L288 172 L304 248 L318 300',
  'M202 282 L196 370 L192 440 L188 506',
  'M238 282 L244 370 L248 440 L252 506',
]
const TORSO = 'M180 102 Q220 92 260 102 L272 128 L262 200 L256 248 L264 286 L176 286 L184 248 L178 200 L168 128 Z'
const RIBS = ['M196 132 Q220 124 244 132', 'M192 148 Q220 140 248 148', 'M190 164 Q220 156 250 164', 'M192 180 Q220 172 248 180', 'M196 196 Q220 188 244 196']

/**
 * The game's health screen for a boss: a red figure with a tag per body part — its name, an orange bar and
 * «current/max». Bosses are shown at full health, so the bars are full. The vitals under the figure in the game
 * (energy, hydration, weight) are left out.
 */
export function BodyHealthFigure({ body, current }: { body: BodyParts; current?: BodyParts }) {
  // useId has characters an SVG url(#…) reference does not take
  const glow = `body-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <figure className="body-figure">
      <svg viewBox="0 0 440 520" role="img" aria-label={`${uiText('Здоровье')}: ${body.map((value, part) => `${uiText(BODY_PART_NAMES[part])} ${current?.[part] ?? value}/${value}`).join(', ')}`}>
        <defs>
          <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g className="body-figure-body" filter={`url(#${glow})`} aria-hidden="true">
          {LIMBS.map((d) => <path key={d} d={d} className="body-figure-limb-edge" />)}
          {LIMBS.map((d) => <path key={`${d}-in`} d={d} className="body-figure-limb" />)}
          <path d={TORSO} className="body-figure-torso" />
          <ellipse cx="220" cy="62" rx="23" ry="29" className="body-figure-torso" />
          <path d="M210 90 L212 102 L228 102 L230 90" className="body-figure-torso" />
          <path d="M220 104 L220 284" className="body-figure-bone" />
          {RIBS.map((d) => <path key={d} d={d} className="body-figure-bone" />)}
          <path d="M190 262 Q220 252 250 262 L246 282 L194 282 Z" className="body-figure-bone" />
        </g>
        {TAGS.map((tag, part) => {
          const max = body[part]
          const now = Math.max(0, Math.min(max, current?.[part] ?? max))
          return (
            <g key={part} className={`body-figure-tag${part < 2 ? ' is-lethal' : ''}`} transform={`translate(${tag.x} ${tag.y})`}>
              <title>{`${uiText(BODY_PART_NAMES[part])}: ${now}/${max} HP`}</title>
              <path d={`M0 0 H${TAG_W - 10} L${TAG_W} 10 V${TAG_H} H0 Z`} className="body-figure-tag-box" />
              <text x="7" y="12" className="body-figure-name">{uiText(BODY_PART_NAMES[part])}</text>
              <rect x="6" y="17" width={TAG_W - 12} height="11" className="body-figure-bar" />
              <rect x="6" y="17" width={(TAG_W - 12) * (max ? now / max : 0)} height="11" className="body-figure-bar-fill" />
              <text x={TAG_W / 2} y="26" textAnchor="middle" className="body-figure-value">{now}/{max}</text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
