import { createPortal } from 'react-dom'
import { useTelnyashkaActive } from './useTelnyashkaActive'

/**
 * «Тельняшка» theme: a small original still life in the empty foot of the sidebar — an enamel mug, a plain
 * unlabelled bottle, a partly sliced sausage and a few gherkins on a wooden cutting board. Rendered only while
 * `<html data-theme="telnyashka">` is set. Only the sausage takes the pointer: hovering it slides the cut
 * slices apart across the board (CSS transitions in themes.css; disabled for prefers-reduced-motion).
 */
export function TelnyashkaTable() {
  const active = useTelnyashkaActive()
  if (!active) return null
  return createPortal(<TableScene />, document.body)
}

const SLICES = [
  { x: 164, y: 62 },
  { x: 173, y: 68 },
  { x: 161, y: 72 },
  { x: 150, y: 76 },
]
const PICKLES = [
  { x: 112, y: 54, r: -10, s: 1.2 },
  { x: 133, y: 51.5, r: 9, s: 1.1 },
  { x: 76, y: 74, r: -22, s: 1.15 },
]
const SPECKS: [number, number, number][] = [[-2.6, -1, 0.7], [1.8, -1.4, 0.55], [2.9, 0.9, 0.6], [-0.6, 1.2, 0.5], [-3.6, 0.8, 0.45], [0.4, -0.2, 0.4]]

function Pickle({ x, y, r, s, back }: { x: number; y: number; r: number; s: number; back?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <ellipse cx="0.6" cy="3.2" rx="9.5" ry="2.4" fill="#000" opacity=".35" filter="url(#tt-soft)" />
      <path d="M-9.6 0 Q-9.4 -3.9 -1 -4 Q8.6 -3.9 9.8 -0.2 Q9.2 3.8 -0.6 4 Q-9.6 3.9 -9.6 0 Z" fill="url(#tt-pickle)" />
      <g fill="#223110" opacity=".55">
        <circle cx="-5.5" cy="-1.6" r=".55" /><circle cx="-2" cy="-2.4" r=".5" /><circle cx="2" cy="-1.8" r=".55" />
        <circle cx="5.6" cy="-2.2" r=".45" /><circle cx="-4" cy="1.4" r=".5" /><circle cx="0.6" cy="1.8" r=".5" /><circle cx="4.8" cy="1.2" r=".5" />
      </g>
      <path d="M-6.5 -2.3 Q0 -3.4 6.5 -2.4" stroke="#e6f0b8" strokeOpacity={back ? 0.28 : 0.4} strokeWidth=".8" fill="none" strokeLinecap="round" />
      <path d="M9.6 -0.4 l2 -0.6" stroke="#6d6a2c" strokeWidth="1.3" strokeLinecap="round" />
    </g>
  )
}

function TableScene() {
  return (
    <div className="tel-table" aria-hidden="true">
      <svg viewBox="0 0 200 92" width="200" height="92">
        <defs>
          <filter id="tt-soft" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="1.6" /></filter>
          <radialGradient id="tt-table-fade" cx=".5" cy=".64" r=".5"><stop offset=".42" stopColor="#fff" /><stop offset=".72" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
          <mask id="tt-table-mask"><rect x="-10" y="26" width="220" height="70" fill="url(#tt-table-fade)" /></mask>
          <linearGradient id="tt-board" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" stopColor="#c89a62" /><stop offset=".6" stopColor="#a8783f" /><stop offset="1" stopColor="#8a5f31" /></linearGradient>
          <linearGradient id="tt-glass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5f7b7c" stopOpacity=".75" /><stop offset=".22" stopColor="#dfeeec" stopOpacity=".85" />
            <stop offset=".5" stopColor="#9fb9b8" stopOpacity=".6" /><stop offset=".78" stopColor="#c9e0de" stopOpacity=".7" /><stop offset="1" stopColor="#34494a" stopOpacity=".85" />
          </linearGradient>
          <linearGradient id="tt-cap" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#6b6e70" /><stop offset=".4" stopColor="#e4e6e4" /><stop offset="1" stopColor="#545759" /></linearGradient>
          <linearGradient id="tt-label" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a9a290" /><stop offset=".3" stopColor="#efe9d8" /><stop offset=".75" stopColor="#d8d1bd" /><stop offset="1" stopColor="#8e8878" /></linearGradient>
          <linearGradient id="tt-mug" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5f5f5a" /><stop offset=".5" stopColor="#c4c4bb" /><stop offset=".8" stopColor="#8fb3b3" /><stop offset="1" stopColor="#3c3c38" /></linearGradient>
          <linearGradient id="tt-casing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b8574a" /><stop offset=".35" stopColor="#8a3127" /><stop offset="1" stopColor="#3f130e" /></linearGradient>
          <radialGradient id="tt-cut" cx=".45" cy=".42" r=".6"><stop offset="0" stopColor="#e7867a" /><stop offset=".75" stopColor="#c45a4e" /><stop offset="1" stopColor="#9c3a30" /></radialGradient>
          <linearGradient id="tt-pickle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8aa347" /><stop offset=".45" stopColor="#557029" /><stop offset="1" stopColor="#263610" /></linearGradient>
          <clipPath id="tt-board-clip"><path d="M44 50 L167 46.5 Q174 46.3 175.4 51 L176.6 55 L189 54.6 Q197 54.8 197 61.6 Q197 68.4 189 68.4 L180.2 68.6 L182.4 75.2 Q183.6 79.4 178.4 79.6 L31 83.6 Q24.2 83.8 25.6 78.4 L37.8 54.2 Q39.4 50.2 44 50 Z" /></clipPath>
        </defs>

        {/* the table: dark planks fading out into the sidebar */}
        <g mask="url(#tt-table-mask)">
          <rect x="0" y="30" width="200" height="62" fill="#3a2a1d" />
          <path d="M0 50 H200 M0 66 H200 M0 84 H200" stroke="#140e0a" strokeWidth="1.1" />
          <path d="M0 43 Q60 41 120 44 T200 42 M0 58 Q70 56 130 59 T200 57 M0 75 Q60 73 110 76 T200 74" stroke="#4a3626" strokeWidth=".6" fill="none" opacity=".7" />
        </g>

        {/* cutting board: soft shadow, end-grain edge, top face with grain and a hanging hole */}
        <path d="M30 88 L182 83 Q196 70 188 57 L60 54 Z" fill="#000" opacity=".55" filter="url(#tt-soft)" />
        <path transform="translate(0 4)" d="M44 50 L167 46.5 Q174 46.3 175.4 51 L176.6 55 L189 54.6 Q197 54.8 197 61.6 Q197 68.4 189 68.4 L180.2 68.6 L182.4 75.2 Q183.6 79.4 178.4 79.6 L31 83.6 Q24.2 83.8 25.6 78.4 L37.8 54.2 Q39.4 50.2 44 50 Z" fill="#5a3a1c" />
        <path d="M44 50 L167 46.5 Q174 46.3 175.4 51 L176.6 55 L189 54.6 Q197 54.8 197 61.6 Q197 68.4 189 68.4 L180.2 68.6 L182.4 75.2 Q183.6 79.4 178.4 79.6 L31 83.6 Q24.2 83.8 25.6 78.4 L37.8 54.2 Q39.4 50.2 44 50 Z" fill="url(#tt-board)" />
        <g clipPath="url(#tt-board-clip)" fill="none" stroke="#6b451f" strokeWidth=".6" opacity=".55">
          <path d="M30 57 Q90 53 140 55 T200 51" /><path d="M26 63 Q80 60 120 62 Q160 64 200 58" />
          <path d="M22 70 Q70 67 110 69 T200 65" /><path d="M20 77 Q90 73 150 75 T200 72" />
          <path d="M60 60 q10 -2 20 0 q-10 1.6 -20 0" strokeWidth=".5" />
        </g>
        <path d="M31 83.6 L178.4 79.6" stroke="#e8c48f" strokeOpacity=".35" strokeWidth=".7" />
        <ellipse cx="190.5" cy="61.6" rx="2.6" ry="2.1" fill="#2a1a0c" />

        {/* a plain bottle, no label text — just a blank paper band */}
        <ellipse cx="57" cy="60.6" rx="12" ry="2.6" fill="#000" opacity=".45" filter="url(#tt-soft)" />
        <path d="M46 30 Q46 24 52.6 20.6 L53.4 11.4 H58.6 L59.4 20.6 Q66 24 66 30 V58.4 Q56 61.6 46 58.4 Z" fill="url(#tt-glass)" stroke="#1f2b2b" strokeWidth=".5" strokeOpacity=".7" />
        <path d="M47.6 58.2 Q56 60.6 64.4 58.2" stroke="#e9f3f1" strokeOpacity=".4" strokeWidth=".7" fill="none" />
        <path d="M46 36 Q56 38.6 66 36 V48.4 Q56 51 46 48.4 Z" fill="url(#tt-label)" />
        <path d="M46 38.4 Q56 41 66 38.4 M46 46 Q56 48.6 66 46" stroke="#8e3a33" strokeOpacity=".55" strokeWidth=".6" fill="none" />
        <path d="M49 29 Q48.6 25.8 52 23.6 M49 50.8 V56.4" stroke="#fff" strokeOpacity=".75" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M54.6 13 V19" stroke="#fff" strokeOpacity=".6" strokeWidth=".8" strokeLinecap="round" />
        <rect x="52.8" y="3.6" width="6.4" height="8.2" rx="1.1" fill="url(#tt-cap)" />
        <path d="M54.2 4.6 V11 M55.6 4.6 V11 M57 4.6 V11 M58.2 4.6 V11" stroke="#3d3f41" strokeOpacity=".45" strokeWidth=".4" />
        <path d="M52.8 10.2 H59.2" stroke="#2c2e30" strokeOpacity=".6" strokeWidth=".6" />

        {/* gherkins behind the sausage */}
        {PICKLES.slice(0, 2).map((p) => <Pickle key={`${p.x}`} {...p} back />)}

        {/* the sausage: the only interactive bit — hovering it spreads the slices */}
        <g className="tel-sausage">
          <g className="tel-sausage-log">
            <ellipse cx="126" cy="68.6" rx="34" ry="4" transform="rotate(-9 126 70)" fill="#000" opacity=".5" filter="url(#tt-soft)" />
            <g transform="translate(95 67) rotate(-9)">
              <path d="M-5 -8 H60 V8 H-5 A8 8 0 0 1 -5 -8 Z" fill="url(#tt-casing)" />
              <path d="M-4 -5 H56" stroke="#f2b3a6" strokeOpacity=".35" strokeWidth="1.1" strokeLinecap="round" />
              <g fill="#f3e4d6" opacity=".22"><circle cx="8" cy="-1" r=".7" /><circle cx="22" cy="2" r=".6" /><circle cx="35" cy="-2" r=".7" /><circle cx="47" cy="1.6" r=".6" /></g>
              <path d="M-11.4 -1.6 q-2.6 -1.4 -4.2 0.2 M-11.4 -1.6 q-1.6 2.4 -3.6 3" stroke="#d9cba6" strokeWidth=".8" fill="none" strokeLinecap="round" />
              <circle cx="-12.6" cy="-0.6" r="1.8" fill="#c9b893" />
              <ellipse cx="60" cy="0" rx="3.4" ry="8" fill="url(#tt-cut)" stroke="#5a1a14" strokeWidth=".6" />
              <g fill="#fbeee2" opacity=".85"><circle cx="59.6" cy="-3.8" r=".6" /><circle cx="60.8" cy="0.6" r=".65" /><circle cx="59.4" cy="4.2" r=".55" /><circle cx="61" cy="-1.6" r=".45" /></g>
            </g>
          </g>
          {SLICES.map((s, i) => (
            <g key={i} className={`tel-slice tel-slice-${i + 1}`}>
              <g transform={`translate(${s.x} ${s.y})`}>
                <ellipse cx=".6" cy="2.6" rx="6.4" ry="2.8" fill="#000" opacity=".45" filter="url(#tt-soft)" />
                <ellipse cx="0" cy="1.4" rx="7" ry="3.9" fill="#5e1c15" />
                <ellipse cx="0" cy="0" rx="7" ry="3.9" fill="url(#tt-cut)" stroke="#6a2019" strokeWidth=".7" />
                <g fill="#fbeee2" opacity=".85">
                  {SPECKS.map(([sx, sy, sr], j) => <ellipse key={j} cx={sx * ((i % 2) ? -1 : 1)} cy={sy} rx={sr} ry={sr * 0.6} />)}
                </g>
                <path d="M-4 -2 Q0 -3.2 4 -2" stroke="#ffd2c8" strokeOpacity=".4" strokeWidth=".6" fill="none" />
              </g>
            </g>
          ))}
        </g>

        {/* one more gherkin in front */}
        <Pickle {...PICKLES[2]} />

        {/* the enamel mug, handle to the left, a navy rim */}
        <ellipse cx="21" cy="87.6" rx="13" ry="2.6" fill="#000" opacity=".55" filter="url(#tt-soft)" />
        <path d="M9.4 66.4 q-8.2 0 -8.2 7.6 q0 7.6 8.2 7.6" stroke="#6f6f69" strokeWidth="3.2" fill="none" />
        <path d="M9.4 66.4 q-8.2 0 -8.2 7.6 q0 7.6 8.2 7.6" stroke="#c9c9c0" strokeOpacity=".35" strokeWidth="1" fill="none" transform="translate(0 -.6)" />
        <path d="M9 61.4 V83.4 Q9 87.4 13 87.4 H28 Q32 87.4 32 83.4 V61.4 Z" fill="url(#tt-mug)" />
        <ellipse cx="20.5" cy="61.4" rx="11.5" ry="3.1" fill="#2a1a10" stroke="#23406f" strokeWidth="1.2" />
        <ellipse cx="20.5" cy="61.9" rx="9.4" ry="2" fill="#4a2a14" opacity=".8" />
        <path d="M9.3 85 Q20.5 88.6 31.7 85" stroke="#23406f" strokeWidth="1" fill="none" opacity=".85" />
        <path d="M14 65 V82" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" strokeLinecap="round" />
        <ellipse cx="27.4" cy="76" rx="1.2" ry="0.9" fill="#1a1a18" opacity=".7" />
        <path d="M17 57 q-2.5 -4 .8 -8 q3 -4 0 -8 M23 57 q-2.5 -4 .8 -8 q3 -4 0 -8" stroke="#e8e2d2" strokeWidth="1.2" fill="none" opacity=".28" strokeLinecap="round" />
      </svg>
    </div>
  )
}
