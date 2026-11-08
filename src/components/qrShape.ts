import qrcode from 'qrcode-generator'

/**
 * The Raid OS QR code (owner, 09.11.2026: «придумай какие-то QR-коды прикольные. Красивые. Не просто белые и черные, а в
 * стиле нашего приложения… чтобы они работали»): round dark dots on a warm light plate, the three corner eyes as rounded
 * brass-brown rings with dark pupils, the app's emblem in the middle. What keeps it readable by every phone camera: dark
 * on light with strong contrast, a quiet zone of QUIET modules, error correction M (15 %: H or Q add modules and make
 * every module smaller, which read worse on a small screen) and the emblem over LOGO_SHARE of the side (about 5 % of
 * the area), the modules under it left out. Checked 09.11.2026 with ZXing and jsQR at 90–320 px, sharp, blurred and
 * scaled down: ZXing reads it exactly where it reads the old plain black-and-white code.
 */
export const QR_COLORS = { plate: '#f3ead6', dot: '#17130d', eye: '#5a4318', pupil: '#17130d', badge: '#f3ead6' } as const
/** Light modules around the code, in modules (the standard asks for 4; 3 is read everywhere and looks tidier). */
const QUIET = 3
/** The emblem's side as a share of the code's side (without the quiet zone). */
const LOGO_SHARE = 0.22
/** Dot radius in modules: big enough to read as a module, small enough to look like dots. */
export const DOT_RADIUS = 0.47

export interface QrGeometry {
  /** Side of the whole picture, quiet zone included, in modules. */
  size: number
  dots: Array<{ x: number; y: number }>
  /** Top-left corners of the three 7 × 7 eyes. */
  eyes: Array<{ x: number; y: number }>
  /** The emblem's square (cleared of modules), or undefined for a code too small to carry it. */
  logo?: { x: number; y: number; side: number }
}

export function qrGeometry(value: string): QrGeometry {
  const qr = qrcode(0, 'M')
  qr.addData(value, 'Byte')
  qr.make()
  const count = qr.getModuleCount()
  // The emblem's square, centred, an odd number of modules, with one module of air around it.
  let logoModules = Math.floor(count * LOGO_SHARE)
  if (logoModules % 2 === 0) logoModules -= 1
  const withLogo = logoModules >= 5
  const start = Math.floor((count - logoModules) / 2)
  const clearFrom = start - 1
  const clearTo = start + logoModules
  const inEye = (row: number, col: number) => (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7)
  const underLogo = (row: number, col: number) => withLogo && row >= clearFrom && row <= clearTo && col >= clearFrom && col <= clearTo
  const dots: QrGeometry['dots'] = []
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col) && !inEye(row, col) && !underLogo(row, col)) dots.push({ x: col + QUIET, y: row + QUIET })
    }
  }
  return {
    size: count + QUIET * 2,
    dots,
    eyes: [{ x: QUIET, y: QUIET }, { x: QUIET + count - 7, y: QUIET }, { x: QUIET, y: QUIET + count - 7 }],
    ...(withLogo ? { logo: { x: start + QUIET, y: start + QUIET, side: logoModules } } : {}),
  }
}

/** One eye: a rounded ring 7 modules wide and 1 thick, and a rounded 3 × 3 pupil. */
export function eyeShapes(x: number, y: number) {
  return {
    ring: { x: x + 0.5, y: y + 0.5, side: 6, radius: 2, stroke: 1 },
    pupil: { x: x + 2, y: y + 2, side: 3, radius: 0.9 },
  }
}

/** The whole code as SVG markup (the same picture QrCode.tsx draws): for tests and for saving as a file. */
export function qrSvg(value: string, logoHref?: string) {
  const g = qrGeometry(value)
  const c = QR_COLORS
  const dots = g.dots.map((d) => `<circle cx="${d.x + 0.5}" cy="${d.y + 0.5}" r="${DOT_RADIUS}"/>`).join('')
  const eyes = g.eyes.map((e) => {
    const { ring, pupil } = eyeShapes(e.x, e.y)
    return `<rect x="${ring.x}" y="${ring.y}" width="${ring.side}" height="${ring.side}" rx="${ring.radius}" fill="none" stroke="${c.eye}" stroke-width="${ring.stroke}"/>`
      + `<rect x="${pupil.x}" y="${pupil.y}" width="${pupil.side}" height="${pupil.side}" rx="${pupil.radius}" fill="${c.pupil}"/>`
  }).join('')
  const logo = g.logo
    ? `<rect x="${g.logo.x - 0.5}" y="${g.logo.y - 0.5}" width="${g.logo.side + 1}" height="${g.logo.side + 1}" rx="1.4" fill="${c.badge}" stroke="${c.eye}" stroke-width="0.35"/>`
      + (logoHref ? `<image href="${logoHref}" x="${g.logo.x + 0.4}" y="${g.logo.y + 0.4}" width="${g.logo.side - 0.8}" height="${g.logo.side - 0.8}"/>` : '')
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.size} ${g.size}"><rect width="${g.size}" height="${g.size}" rx="2" fill="${c.plate}"/><g fill="${c.dot}">${dots}</g>${eyes}${logo}</svg>`
}
