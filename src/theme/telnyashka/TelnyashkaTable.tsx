import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import baseUrl from '../../assets/textures/telnyashka/table/base.webp'
import sausageUrl from '../../assets/textures/telnyashka/table/sausage.webp'
import slice1Url from '../../assets/textures/telnyashka/table/slice-1.webp'
import slice2Url from '../../assets/textures/telnyashka/table/slice-2.webp'
import slice3Url from '../../assets/textures/telnyashka/table/slice-3.webp'
import slice4Url from '../../assets/textures/telnyashka/table/slice-4.webp'
import slice5Url from '../../assets/textures/telnyashka/table/slice-5.webp'
import { TABLE_LAYOUT as L } from './tableLayers'
import { useTelnyashkaActive } from './useTelnyashkaActive'
import './table.css'

/**
 * «Тельняшка» theme: a small original still life in the empty foot of the sidebar — a crumpled telnyashka towel,
 * a worn cutting board with a salami and its cut slices, pickled gherkins, an empty chipped enamel mug and a plain
 * unlabelled bottle. The picture is a 3D render (scripts/textures/telnyashka/table/render.mjs) split into layers:
 * a static base, the sausage and each slice. Rendered only while `<html data-theme="telnyashka">` is set.
 * Only the sausage and its slices take the pointer: hovering them backs the sausage off and slides the slices apart
 * (CSS transitions in table.css; no animation under prefers-reduced-motion).
 */
export function TelnyashkaTable() {
  const active = useTelnyashkaActive()
  if (!active) return null
  return createPortal(<TableScene />, document.body)
}

const SLICE_URLS = [slice1Url, slice2Url, slice3Url, slice4Url, slice5Url]

type Box = { x: number; y: number; w: number; h: number }
const place = ({ x, y, w, h }: Box): CSSProperties => ({ left: x, top: y, width: w, height: h })

// back-to-front, so a nearer slice overlaps the one behind it
const SLICES = L.slices
  .map((s, i) => ({ ...s, url: SLICE_URLS[i], key: i }))
  .sort((a, b) => a.y + a.h - (b.y + b.h))

function TableScene() {
  const [fx, fy] = L.hit.from
  const [tx, ty] = L.hit.to
  return (
    <div className="tel-still" aria-hidden="true" style={{ width: L.width, height: L.height }}>
      <img className="tel-still-layer" src={baseUrl} alt="" draggable={false} style={place(L.base)} />
      <div className="tel-still-sausage">
        <img
          className="tel-still-layer tel-still-log"
          src={sausageUrl}
          alt=""
          draggable={false}
          style={{ ...place(L.sausage), '--dx': `${L.sausage.dx}px`, '--dy': `${L.sausage.dy}px` } as CSSProperties}
        />
        {SLICES.map((s) => (
          <img
            key={s.key}
            className="tel-still-layer tel-still-slice"
            src={s.url}
            alt=""
            draggable={false}
            style={{ ...place(s), '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, '--rot': `${s.rot}deg`, transitionDelay: `${s.key * 0.03}s` } as CSSProperties}
          />
        ))}
        {/* the pointer target: a capsule along the sausage plus a disc per slice */}
        <svg className="tel-still-hit" viewBox={`0 0 ${L.width} ${L.height}`} width={L.width} height={L.height}>
          <line x1={fx} y1={fy} x2={tx} y2={ty} strokeWidth="15" strokeLinecap="round" />
          {L.hit.slices.map(([cx, cy], i) => <ellipse key={i} cx={cx} cy={cy} rx="8" ry="6" />)}
        </svg>
      </div>
    </div>
  )
}
