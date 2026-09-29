// Generates src/assets/textures/telnyashka/yard-dusk.svg — an original dusk courtyard skyline for the Telnyashka theme.
import fs from 'node:fs'
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const W = 1600, H = 480
const blocks = [
  // x, top, width, cell w, cell h  (panel blocks, back row)
  [-10, 150, 250, 22, 26], [215, 96, 300, 22, 26], [560, 180, 220, 20, 24], [760, 118, 330, 22, 26], [1130, 160, 230, 20, 24], [1370, 104, 260, 22, 26],
]
let out = []
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">`)
out.push(`<!-- Original backdrop for the Telnyashka theme: panel blocks at dusk, a row of garages, laundry on a line and a street lamp -->`)
out.push(`<defs>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23262b"/><stop offset="1" stop-color="#15161a"/></linearGradient>
<linearGradient id="gar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1a18"/><stop offset="1" stop-color="#0d0c0b"/></linearGradient>
<pattern id="ribs" width="6" height="10" patternUnits="userSpaceOnUse"><rect width="6" height="10" fill="#1f1d1a"/><rect width="2" height="10" fill="#151311"/></pattern>
<pattern id="tel" width="10" height="7" patternUnits="userSpaceOnUse"><rect width="10" height="7" fill="#d9dcdf"/><rect width="10" height="3" fill="#1d3f78"/></pattern>
<radialGradient id="lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".55"/><stop offset=".4" stop-color="#e0a55a" stop-opacity=".16"/><stop offset="1" stop-color="#e0a55a" stop-opacity="0"/></radialGradient>
<radialGradient id="door" cx=".5" cy="1" r=".9"><stop offset="0" stop-color="#e8a95a" stop-opacity=".9"/><stop offset="1" stop-color="#8a5a2a" stop-opacity=".3"/></radialGradient>
</defs>`)
for (const [x, top, w, cw, ch] of blocks) {
  out.push(`<rect x="${x}" y="${top}" width="${w}" height="${H - top}" fill="url(#wall)"/>`)
  out.push(`<rect x="${x}" y="${top}" width="${w}" height="4" fill="#2e3238"/>`)
  // panel seams and windows: dark windows via a per-block pattern, only the lit ones as separate rects
  const pid = `win${Math.round(x + 20)}`
  out.push(`<pattern id="${pid}" x="${x + 10}" y="${top + 14}" width="${cw}" height="${ch}" patternUnits="userSpaceOnUse"><rect width="${cw - 10}" height="${ch - 12}" fill="#0d0e11" fill-opacity=".9"/><rect y="${ch - 6}" width="${cw}" height="1" fill="#101114" fill-opacity=".8"/></pattern>`)
  const cols = Math.floor((w - 24) / cw) + 1, nrows = Math.floor((H - 20 - top - 14) / ch) + 1
  out.push(`<rect x="${x + 10}" y="${top + 14}" width="${cols * cw - 10}" height="${H - top - 14}" fill="url(#${pid})"/>`)
  let rows = ''
  for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
    const v = rnd()
    if (v >= 0.12) continue
    const fill = v < 0.07 ? '#e0a55a' : v < 0.1 ? '#f2c98a' : '#7fb6c9'
    rows += `<rect x="${x + 10 + c * cw}" y="${top + 14 + r * ch}" width="${cw - 10}" height="${ch - 12}" fill="${fill}" fill-opacity="${(0.45 + rnd() * 0.35).toFixed(2)}"/>`
  }
  out.push(rows)
  // rim light from the right (teal) on the block's right edge
  out.push(`<rect x="${x + w - 3}" y="${top}" width="3" height="${H - top}" fill="#6cc4c9" fill-opacity=".18"/>`)
  // rooftop antennas
  const ax = x + 30 + rnd() * (w - 60)
  out.push(`<path d="M${ax} ${top} v-26 M${ax - 10} ${top - 20} h20 M${ax - 7} ${top - 13} h14" stroke="#23262b" stroke-width="2"/>`)
}
// laundry line with a telnyashka and tracksuit bottoms
out.push(`<path d="M1010 470 V300 M1290 470 V296" stroke="#0e0e0f" stroke-width="5"/>`)
out.push(`<path d="M1010 306 Q1150 334 1290 302" stroke="#8b8a86" stroke-opacity=".6" stroke-width="1.4" fill="none"/>`)
out.push(`<g transform="translate(1080 318) rotate(4)"><path d="M0 0 L14 -2 Q22 6 30 -2 L44 0 L56 16 L46 24 L42 18 L42 64 L4 64 L4 18 L0 24 L-10 16 Z" fill="url(#tel)" fill-opacity=".8"/><path d="M0 0 L14 -2 Q22 6 30 -2 L44 0 L56 16 L46 24 L42 18 L42 64 L4 64 L4 18 L0 24 L-10 16 Z" fill="#000" fill-opacity=".35"/></g>`)
out.push(`<g transform="translate(1170 322) rotate(-3)"><path d="M0 0 H40 L42 78 H26 L20 22 L14 78 H-2 Z" fill="#101012"/><path d="M4 2 L1 76 M8 2 L5 76 M36 2 L39 76 M32 2 L35 76" stroke="#d9d4c8" stroke-opacity=".7" stroke-width="1.5"/></g>`)
out.push(`<g transform="translate(1232 316) rotate(6)"><rect width="22" height="30" fill="#6b6f74" fill-opacity=".7"/><rect width="22" height="30" fill="#000" fill-opacity=".3"/></g>`)
// street lamp
out.push(`<circle cx="548" cy="306" r="120" fill="url(#lamp)"/>`)
out.push(`<path d="M520 480 V300 Q520 290 532 290 H548" stroke="#0c0c0d" stroke-width="5" fill="none"/>`)
out.push(`<path d="M538 288 h22 l-4 8 h-14 z" fill="#1a1a1a"/><rect x="542" y="296" width="14" height="3" fill="#ffd9a0"/>`)
// garages (front row)
const gy = 404
out.push(`<rect x="0" y="${gy}" width="${W}" height="${H - gy}" fill="url(#gar)"/>`)
out.push(`<rect x="0" y="${gy - 6}" width="${W}" height="7" fill="#232120"/>`)
for (let gx = 12, i = 0; gx < W; gx += 92, i++) {
  if (i === 6) {
    out.push(`<rect x="${gx}" y="${gy + 14}" width="76" height="${H - gy - 14}" fill="url(#door)"/>`)
    out.push(`<rect x="${gx}" y="${gy + 14}" width="76" height="24" fill="url(#ribs)"/>`)
  } else {
    out.push(`<rect x="${gx}" y="${gy + 14}" width="76" height="${H - gy - 14}" fill="url(#ribs)"/>`)
  }
  out.push(`<rect x="${gx - 8}" y="${gy + 8}" width="92" height="3" fill="#0a0908"/>`)
}
out.push(`</svg>`)
const svg = out.join('\n')
fs.writeFileSync(new URL('../../../src/assets/textures/telnyashka/yard-dusk.svg', import.meta.url), svg + '\n')
console.log(svg.length)
