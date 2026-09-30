import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/** A QR code as SVG: dark modules on a white plate with a quiet zone, readable by phone cameras in any theme. */
export function LoginQr({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value, 'Byte')
    qr.make()
    const modules = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < modules; row += 1) for (let col = 0; col < modules; col += 1) if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`
    return { path: d, count: modules + 8 }
  }, [value])
  return (
    <svg className="login-qr" width={size} height={size} viewBox={`0 0 ${count} ${count}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={count} height={count} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
