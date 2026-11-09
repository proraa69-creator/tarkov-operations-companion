import { describe, expect, it } from 'vitest'
import qrcode from 'qrcode-generator'
import { qrGeometry, qrSvg } from './qrShape'

// Owner, 09.11.2026: «QR-коды… в стиле нашего приложения, чтобы они работали».
describe('the Raid OS QR code', () => {
  const value = 'https://raidos.app/m/qr?code=K7Q2-9ZXA&t=Zx3v8Qp2LmN4rT6yUw1aBc5dEf7gHi9jKl0mNo2pQr4s'

  it('draws every dark module as a dot, except the corner eyes and the emblem square', () => {
    const qr = qrcode(0, 'M')
    qr.addData(value, 'Byte')
    qr.make()
    const count = qr.getModuleCount()
    const g = qrGeometry(value)
    expect(g.size).toBe(count + 6)
    const dots = new Set(g.dots.map((d) => `${d.x - 3},${d.y - 3}`))
    let dark = 0
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        const eye = (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7)
        const logo = g.logo && row >= g.logo.y - 4 && row <= g.logo.y - 3 + g.logo.side && col >= g.logo.x - 4 && col <= g.logo.x - 3 + g.logo.side
        if (qr.isDark(row, col) && !eye && !logo) { dark += 1; expect(dots.has(`${col},${row}`)).toBe(true) }
        if (!qr.isDark(row, col)) expect(dots.has(`${col},${row}`)).toBe(false)
      }
    }
    expect(g.dots).toHaveLength(dark)
  })

  it('keeps the emblem small: an odd square of about a fifth of the side, in the middle', () => {
    const g = qrGeometry(value)
    expect(g.logo).toBeDefined()
    const inner = g.size - 6
    expect(g.logo!.side % 2).toBe(1)
    expect(g.logo!.side / inner).toBeLessThanOrEqual(0.22)
    expect(g.logo!.x - 3 + g.logo!.side / 2).toBeCloseTo(inner / 2, 0)
  })

  it('leaves the emblem out of a code too small to carry it', () => {
    expect(qrGeometry('a').logo).toBeUndefined()
  })

  it('makes SVG markup with the plate, the dots and three eyes', () => {
    const svg = qrSvg(value, 'data:image/webp;base64,AAAA')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.match(/<rect [^>]*stroke-width="1"/g)).toHaveLength(3)
    expect(svg).toContain('<image href="data:image/webp;base64,AAAA"')
  })
})
