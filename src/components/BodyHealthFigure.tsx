import { uiText } from '../i18n/renderText'
import bodyPicture from '../assets/boss-health/xray-body.webp'

/** Head, thorax, stomach, left arm, right arm, left leg, right leg (the game's order). */
export type BodyParts = readonly [number, number, number, number, number, number, number]

const BODY_PART_NAMES = ['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'] as const

/**
 * Centre of each part's window on the owner's X-ray picture (1328×2000, the figure faces the viewer, so its right arm
 * and leg are on the left), in % of the picture — laid out like the game's health screen.
 */
const WINDOWS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 82, y: 14.5 },
  { x: 57.5, y: 27.7 },
  { x: 55, y: 38.2 },
  { x: 85, y: 38.2 },
  { x: 23.8, y: 38.2 },
  { x: 81, y: 58.6 },
  { x: 33.5, y: 58.6 },
]

/**
 * Boss health card: the owner's X-ray picture, unchanged, with a game-style window per body part — the part's name on
 * a dark tab and a full bar «HP/HP» (a boss starts at full health). The total is in the panel heading.
 */
export function BodyHealthFigure({ body }: { body: BodyParts }) {
  return (
    <figure className="body-figure" aria-label={`${uiText('Здоровье')}: ${body.map((value, part) => `${uiText(BODY_PART_NAMES[part])} ${value}`).join(', ')}`}>
      <img src={bodyPicture} alt="" width={1328} height={2000} decoding="async" draggable={false} />
      {WINDOWS.map((place, part) => (
        <div key={part} className="body-figure-window" style={{ left: `${place.x}%`, top: `${place.y}%` }}>
          <span className="body-figure-name">{uiText(BODY_PART_NAMES[part])}</span>
          <span className="body-figure-bar"><i /><b className="body-figure-value">{body[part]}/{body[part]}</b></span>
        </div>
      ))}
    </figure>
  )
}
