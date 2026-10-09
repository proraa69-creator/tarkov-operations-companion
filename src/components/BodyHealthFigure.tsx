import { useState } from 'react'
import { uiText } from '../i18n/renderText'
import skeletonPicture from '../assets/boss-health/xray-skeleton.webp'

/** Head, thorax, stomach, left arm, right arm, left leg, right leg (the game's order). */
export type BodyParts = readonly [number, number, number, number, number, number, number]

const BODY_PART_NAMES = ['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'] as const

/**
 * The skeleton is cut out of the owner's X-ray picture (1328×2000) at this box by scripts/boss-health/cutout.mjs —
 * the coordinates below are pixels of that picture. The figure faces the viewer: its right arm and leg are on the left.
 */
const SKELETON_CROP = { left: 360, top: 195, width: 710, height: 1485 }

type Point = readonly [number, number]

/** Every body part's area on the picture, same order as BodyParts. The highlight follows the skeleton inside it. */
const PART_AREAS: ReadonlyArray<readonly Point[]> = [
  [[630, 195], [850, 195], [850, 330], [810, 405], [670, 405], [630, 330]],
  [[650, 405], [830, 405], [880, 470], [866, 560], [860, 720], [620, 720], [614, 560], [600, 470]],
  [[620, 720], [860, 720], [872, 800], [892, 885], [740, 955], [588, 885], [608, 800]],
  [[880, 470], [930, 440], [1000, 560], [1025, 700], [1045, 860], [1035, 995], [895, 995], [905, 860], [880, 760], [860, 720], [866, 560]],
  [[600, 470], [550, 440], [495, 560], [450, 690], [400, 820], [355, 935], [450, 950], [500, 860], [580, 760], [620, 720], [614, 560]],
  [[740, 955], [892, 885], [925, 1000], [925, 1300], [960, 1560], [975, 1680], [840, 1680], [850, 1500], [812, 1250], [780, 1100]],
  [[740, 955], [588, 885], [540, 1000], [535, 1300], [495, 1560], [470, 1680], [610, 1680], [625, 1500], [665, 1250], [705, 1100]],
]

/** CSS clip-path of an area, in % of the cut-out skeleton. */
const clipOf = (area: readonly Point[]) => `polygon(${area.map(([x, y]) => `${((x - SKELETON_CROP.left) / SKELETON_CROP.width * 100).toFixed(2)}% ${((y - SKELETON_CROP.top) / SKELETON_CROP.height * 100).toFixed(2)}%`).join(', ')})`
const CLIPS = PART_AREAS.map(clipOf)

/**
 * Centre of each part's HP window in % of the card (the skeleton fills the middle 60% of its width and its full
 * height), laid out like the game's health screen.
 */
const WINDOWS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 78, y: 7 },
  { x: 52, y: 25 },
  { x: 52, y: 41 },
  { x: 86, y: 41 },
  { x: 14, y: 41 },
  { x: 82, y: 66 },
  { x: 22, y: 66 },
]

/**
 * Boss health card: the skeleton from the owner's X-ray picture with a game-style window per body part — the part's
 * name on a dark tab and a full bar «HP/HP» (a boss starts at full health). Pointing at a window or at the body
 * lights that part of the skeleton and its window; a tap does the same on a touch screen. The total is in the panel
 * heading.
 */
export function BodyHealthFigure({ body }: { body: BodyParts }) {
  const [active, setActive] = useState<number | null>(null)
  const leave = (part: number) => setActive((current) => (current === part ? null : current))
  return (
    <figure className={`body-figure${active === null ? '' : ' has-active'}`} aria-label={`${uiText('Здоровье')}: ${body.map((value, part) => `${uiText(BODY_PART_NAMES[part])} ${value}`).join(', ')}`}>
      <div className="body-figure-skeleton">
        <img className="body-figure-base" src={skeletonPicture} alt="" width={640} height={1339} decoding="async" draggable={false} />
        {CLIPS.map((clip, part) => (
          <img key={part} className={`body-figure-glow${active === part ? ' is-active' : ''}`} src={skeletonPicture} alt="" aria-hidden="true" draggable={false} style={{ clipPath: clip }} />
        ))}
        <svg className="body-figure-areas" viewBox={`${SKELETON_CROP.left} ${SKELETON_CROP.top} ${SKELETON_CROP.width} ${SKELETON_CROP.height}`} preserveAspectRatio="none" aria-hidden="true">
          {PART_AREAS.map((area, part) => (
            <polygon key={part} points={area.map(([x, y]) => `${x},${y}`).join(' ')}
              onPointerEnter={() => setActive(part)} onPointerLeave={() => leave(part)} onClick={() => setActive(part)} />
          ))}
        </svg>
      </div>
      {WINDOWS.map((place, part) => (
        <div key={part} className={`body-figure-window${active === part ? ' is-active' : ''}`} style={{ left: `${place.x}%`, top: `${place.y}%` }} tabIndex={0}
          onPointerEnter={() => setActive(part)} onPointerLeave={() => leave(part)} onFocus={() => setActive(part)} onBlur={() => leave(part)} onClick={() => setActive(part)}>
          <span className="body-figure-name">{uiText(BODY_PART_NAMES[part])}</span>
          <span className="body-figure-bar"><i /><b className="body-figure-value">{body[part]}/{body[part]}</b></span>
        </div>
      ))}
    </figure>
  )
}
