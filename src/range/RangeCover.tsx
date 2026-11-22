import { useId } from 'react'
import { FIGURE_HEIGHT } from './rangeHitboxes'
import type { Cover } from './rangeShot'
import type { CoverTextures } from './rangeCoverData'

/**
 * The covers as things that stand at the range (owner, 22.11.2026: «укрытие не просто квадрат какой-то прозрачный… текстуру…
 * кирпичного здания или контейнера. Если… препятствие низкое, то поставь… ящик… Когда включаешь укрытие, окно, то… кирпичная
 * стена с окном, и будто он стоит в окне этого размера»): a shipping container's corner on the left or the right, a wooden crate
 * in front, a brick wall with a window. The shapes are the ones the bullets meet (src/range/rangeShot.ts behindCover); the
 * textures are the game's own when the pack has them (`tex-…`), else drawn here.
 */

const Y = (y: number) => FIGURE_HEIGHT - y
/** A container is 259 cm tall; the wall is a storey and a half. */
const CONTAINER_TOP = 259
const WALL_TOP = 330
/** The window's opening (as behindCover has it): 68 cm wide, from 118 to 186 cm above the ground. */
const WINDOW = { left: -34, right: 34, bottom: 118, top: 186 }

export function CoverShape({ cover, textures }: { cover: Cover; textures?: CoverTextures }) {
  const id = useId().replace(/:/g, '')
  const brick = `range-brick-${id}`, metal = `range-metal-${id}`, wood = `range-wood-${id}`
  return <g className="range-cover-object" pointerEvents="none">
    <defs>
      {textures?.brick
        ? <pattern id={brick} patternUnits="userSpaceOnUse" width={250} height={250}><image href={textures.brick} width={250} height={250} preserveAspectRatio="none" /></pattern>
        : <pattern id={brick} patternUnits="userSpaceOnUse" width={25} height={13}>
          <rect width={25} height={13} fill="#8a4a35" />
          <path d="M0 6.2H25M0 12.7H25M12.5 0V6.2M0 6.2V12.7M25 6.2V12.7" stroke="#c9b9a2" strokeWidth={1} />
          <rect x={0.6} y={0.6} width={11.4} height={5} fill="#9b5640" />
          <rect x={13.1} y={0.6} width={11.4} height={5} fill="#8f4b38" />
          <rect x={0.6} y={6.8} width={11.4} height={5.4} fill="#7f4130" />
          <rect x={13.1} y={6.8} width={11.4} height={5.4} fill="#985241" />
        </pattern>}
      {textures?.container
        ? <pattern id={metal} patternUnits="userSpaceOnUse" y={Y(CONTAINER_TOP)} width={204} height={CONTAINER_TOP}><image href={textures.container} width={204} height={CONTAINER_TOP} preserveAspectRatio="none" /></pattern>
        : <pattern id={metal} patternUnits="userSpaceOnUse" width={12} height={40}>
          <rect width={12} height={40} fill="#2f5b73" />
          <rect x={0} width={3} height={40} fill="#3c6f8a" />
          <rect x={6} width={3} height={40} fill="#264b5f" />
        </pattern>}
      {textures?.crate
        ? <pattern id={wood} patternUnits="userSpaceOnUse" x={-80} y={Y(108)} width={160} height={54}><image href={textures.crate} width={160} height={54} preserveAspectRatio="none" /></pattern>
        : <pattern id={wood} patternUnits="userSpaceOnUse" width={100} height={18}>
          <rect width={100} height={18} fill="#7a6040" />
          <path d="M0 17.5H100" stroke="#4d3b25" strokeWidth={1} />
          <path d="M0 6H100M0 12H100" stroke="#6b5236" strokeWidth={0.5} />
        </pattern>}
    </defs>
    {cover === 'left' && <>
      <rect x={-400} y={Y(CONTAINER_TOP)} width={402} height={CONTAINER_TOP} fill={`url(#${metal})`} />
      <rect x={-6} y={Y(CONTAINER_TOP)} width={8} height={CONTAINER_TOP} className="range-cover-post" />
      <rect x={-400} y={Y(CONTAINER_TOP)} width={402} height={10} className="range-cover-post" />
    </>}
    {cover === 'right' && <>
      <rect x={-2} y={Y(CONTAINER_TOP)} width={402} height={CONTAINER_TOP} fill={`url(#${metal})`} />
      <rect x={-2} y={Y(CONTAINER_TOP)} width={8} height={CONTAINER_TOP} className="range-cover-post" />
      <rect x={-2} y={Y(CONTAINER_TOP)} width={402} height={10} className="range-cover-post" />
    </>}
    {/* two ammo crates, one on the other (each 160 × 54 cm) */}
    {cover === 'low' && <>
      <rect x={-80} y={Y(108)} width={160} height={108} fill={`url(#${wood})`} />
      <path d={`M-80 ${Y(54)}H80`} className="range-cover-seam" />
      <rect x={-80} y={Y(108)} width={160} height={108} fill="none" className="range-cover-seam" />
    </>}
    {cover === 'window' && <>
      <path fillRule="evenodd" fill={`url(#${brick})`} d={`M-400 ${Y(WALL_TOP)}H400V${Y(0)}H-400Z M${WINDOW.left} ${Y(WINDOW.top)}H${WINDOW.right}V${Y(WINDOW.bottom)}H${WINDOW.left}Z`} />
      {/* the frame and the sill */}
      <path fillRule="evenodd" className="range-cover-frame" d={`M${WINDOW.left - 4} ${Y(WINDOW.top + 4)}H${WINDOW.right + 4}V${Y(WINDOW.bottom - 2)}H${WINDOW.left - 4}Z M${WINDOW.left} ${Y(WINDOW.top)}H${WINDOW.right}V${Y(WINDOW.bottom)}H${WINDOW.left}Z`} />
      <rect x={WINDOW.left - 8} y={Y(WINDOW.bottom - 2)} width={WINDOW.right - WINDOW.left + 16} height={5} className="range-cover-sill" />
    </>}
  </g>
}
