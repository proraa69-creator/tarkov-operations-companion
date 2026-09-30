import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/**
 * A QR code as crisp SVG (qrcode-generator). Dark modules on a light plate with a quiet zone, so phone cameras read it
 * in every colour theme.
 */
export function QrCode({ value, size = 216, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value, 'Byte')
    qr.make()
    const modules = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`
    }
    return { path: d, count: modules + 8 }
  }, [value])
  return (
    <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${count} ${count}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={count} height={count} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
