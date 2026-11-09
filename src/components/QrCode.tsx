import { useMemo } from 'react'
import iconUrl from '../assets/brand-icon.webp'
import { DOT_RADIUS, eyeShapes, QR_COLORS, qrGeometry } from './qrShape'

/**
 * A QR code in the app's style (qrShape.ts): round dark dots on a warm light plate, brass-brown corner eyes and the
 * emblem in the middle. Dark on light with error correction H, so phone cameras read it in every colour theme.
 */
export function QrCode({ value, size = 216, label }: { value: string; size?: number; label: string }) {
  const g = useMemo(() => qrGeometry(value), [value])
  const c = QR_COLORS
  return (
    <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${g.size} ${g.size}`} role="img" aria-label={label}>
      <rect width={g.size} height={g.size} rx={2} fill={c.plate} />
      <g fill={c.dot}>
        {g.dots.map((d) => <circle key={`${d.x}-${d.y}`} cx={d.x + 0.5} cy={d.y + 0.5} r={DOT_RADIUS} />)}
      </g>
      {g.eyes.map((e) => {
        const { ring, pupil } = eyeShapes(e.x, e.y)
        return (
          <g key={`${e.x}-${e.y}`}>
            <rect x={ring.x} y={ring.y} width={ring.side} height={ring.side} rx={ring.radius} fill="none" stroke={c.eye} strokeWidth={ring.stroke} />
            <rect x={pupil.x} y={pupil.y} width={pupil.side} height={pupil.side} rx={pupil.radius} fill={c.pupil} />
          </g>
        )
      })}
      {g.logo && <>
        <rect x={g.logo.x - 0.5} y={g.logo.y - 0.5} width={g.logo.side + 1} height={g.logo.side + 1} rx={1.4} fill={c.badge} stroke={c.eye} strokeWidth={0.35} />
        <image href={iconUrl} x={g.logo.x + 0.4} y={g.logo.y + 0.4} width={g.logo.side - 0.8} height={g.logo.side - 0.8} />
      </>}
    </svg>
  )
}
