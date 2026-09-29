// Generates src/assets/textures/telnyashka/gsk-junkyard.webp — the Telnyashka theme backdrop: an original dusk
// illustration of a garage cooperative (ГСК: brick boxes with flat tar roofs and painted steel double doors) with a
// scrapyard behind its concrete fence, a lamp post, puddles and a burning barrel. Drawn from scratch as an SVG
// (no game art or photos used), then rasterised once by Chromium so the page pays no filter cost at runtime.
//   node scripts/textures/telnyashka/gsk-junkyard.mjs            (needs Playwright's Chromium at /opt/pw-browsers)
//   node scripts/textures/telnyashka/gsk-junkyard.mjs --svg      (also writes the intermediate SVG to the scratch dir)
import { chromium } from 'playwright'
import sharp from 'sharp'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const W = 1920, H = 760 // design units; the top ~40% is transparent sky so the theme's CSS dusk gradient shows through
const OUT_W = 2560
let seed = 1987
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const r = (a, b) => a + rnd() * (b - a)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const f = (n) => Math.round(n * 10) / 10
const out = []
const put = (s) => out.push(s)

const GROUND = 640 // foot of the garage row
const LAMP = { x: 1128, y: 470 } // lamp head of the street light over the lane
const FIRE = { x: 1560, y: 668 } // burning barrel

put(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`)
put(`<defs>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3338" stop-opacity="0"/><stop offset=".45" stop-color="#34393a" stop-opacity=".55"/><stop offset=".75" stop-color="#3b3530" stop-opacity=".62"/><stop offset="1" stop-color="#2a2521" stop-opacity=".2"/></linearGradient>
<linearGradient id="skyglow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e5a48" stop-opacity="0"/><stop offset=".7" stop-color="#7a5f45" stop-opacity=".28"/><stop offset="1" stop-color="#8a6a48" stop-opacity=".42"/></linearGradient>
<linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#262d33"/><stop offset="1" stop-color="#1c2126"/></linearGradient>
<linearGradient id="fence" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4843"/><stop offset="1" stop-color="#2a2825"/></linearGradient>
<pattern id="fencerelief" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M15 3 L27 15 L15 27 L3 15 Z" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="2"/><path d="M15 4 L26 15" stroke="#fff" stroke-opacity=".06" stroke-width="1.2"/></pattern>
<pattern id="brick" width="26" height="12" patternUnits="userSpaceOnUse"><rect width="26" height="12" fill="#221b17"/><rect x="1" y="1" width="24" height="5" fill="#4a3226"/><rect x="-12" y="7" width="24" height="4.4" fill="#45302a"/><rect x="14" y="7" width="24" height="4.4" fill="#503628"/></pattern>
<pattern id="silicate" width="26" height="12" patternUnits="userSpaceOnUse"><rect width="26" height="12" fill="#2a2926"/><rect x="1" y="1" width="24" height="5" fill="#57544c"/><rect x="-12" y="7" width="24" height="4.4" fill="#4f4c45"/><rect x="14" y="7" width="24" height="4.4" fill="#5a574f"/></pattern>
<pattern id="ribs" width="9" height="20" patternUnits="userSpaceOnUse"><rect width="9" height="20" fill="#000" fill-opacity="0"/><rect width="2" height="20" fill="#000" fill-opacity=".32"/><rect x="2" width="1" height="20" fill="#fff" fill-opacity=".05"/></pattern>
<pattern id="chain" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 0 L10 10 M10 0 L0 10" stroke="#8a8a84" stroke-opacity=".35" stroke-width=".8"/></pattern>
<radialGradient id="lampglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd79a" stop-opacity=".75"/><stop offset=".18" stop-color="#f0b56a" stop-opacity=".32"/><stop offset=".55" stop-color="#d9924e" stop-opacity=".1"/><stop offset="1" stop-color="#d9924e" stop-opacity="0"/></radialGradient>
<radialGradient id="pool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e9a863" stop-opacity=".42"/><stop offset=".5" stop-color="#c98a4f" stop-opacity=".14"/><stop offset="1" stop-color="#c98a4f" stop-opacity="0"/></radialGradient>
<radialGradient id="fireglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb35a" stop-opacity=".7"/><stop offset=".25" stop-color="#ea7a2e" stop-opacity=".28"/><stop offset="1" stop-color="#c85a20" stop-opacity="0"/></radialGradient>
<linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd08a" stop-opacity=".24"/><stop offset="1" stop-color="#ffd08a" stop-opacity="0"/></linearGradient>
<linearGradient id="inside" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b060"/><stop offset=".6" stop-color="#b8743a"/><stop offset="1" stop-color="#5a3518"/></linearGradient>
<linearGradient id="spill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9a45c" stop-opacity=".45"/><stop offset="1" stop-color="#e9a45c" stop-opacity="0"/></linearGradient>
<linearGradient id="asphalt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26231f"/><stop offset="1" stop-color="#15130f"/></linearGradient>
<linearGradient id="roofedge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34302b"/><stop offset="1" stop-color="#171411"/></linearGradient>
<linearGradient id="shadeDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
<!-- rust blotches and run-off streaks over painted steel -->
<filter id="rust" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.045 0.09" numOctaves="4" seed="4" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 .29  0 0 0 0 .16  0 0 0 0 .085  3.6 0 0 0 -1.85" result="blot"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.18 0.025" numOctaves="2" seed="9" result="s"/>
  <feColorMatrix in="s" type="matrix" values="0 0 0 0 .14  0 0 0 0 .08  0 0 0 0 .05  3.2 0 0 0 -1.85" result="streak"/>
  <feMerge result="m"><feMergeNode in="SourceGraphic"/><feMergeNode in="blot"/><feMergeNode in="streak"/></feMerge>
  <feComposite in="m" in2="SourceAlpha" operator="in"/>
</filter>
<!-- soot and damp on masonry -->
<filter id="grime" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="4" seed="21" result="n"/>
  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.4 0 0 0 -.9" result="dark"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="g"/>
  <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 -.35" result="speck"/>
  <feMerge result="m"><feMergeNode in="SourceGraphic"/><feMergeNode in="dark"/><feMergeNode in="speck"/></feMerge>
  <feComposite in="m" in2="SourceAlpha" operator="in"/>
</filter>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2"/></filter>
<filter id="blur3" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="cracks" x="0" y="0" width="1" height="1">
  <feTurbulence type="turbulence" baseFrequency="0.02 0.08" numOctaves="3" seed="12" result="t"/>
  <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -9 0 0 0 1.15" result="c"/>
  <feComposite in="c" in2="SourceAlpha" operator="in"/>
</filter>
</defs>`)

// ---------- far layer: hazy panel blocks, a factory stack, a tower crane and power pylons ----------
put(`<rect x="0" y="330" width="${W}" height="${GROUND - 330}" fill="url(#skyglow)"/>`)
const far = []
for (let x = -40; x < W; ) {
  const w = r(110, 240), top = r(340, 450)
  far.push([x, top, w])
  x += w + r(-20, 60)
}
for (const [x, top, w] of far) {
  put(`<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(GROUND - top)}" fill="url(#far)" fill-opacity=".72"/>`)
  let lit = ''
  for (let yy = top + 14; yy < 560; yy += 17) for (let xx = x + 10; xx < x + w - 12; xx += 15) {
    const v = rnd(); if (v > 0.06) continue
    lit += `<rect x="${f(xx)}" y="${f(yy)}" width="7" height="8" fill="${v < 0.04 ? '#d59a55' : '#8fb9c4'}" fill-opacity="${f(r(.25, .5))}"/>`
  }
  put(lit)
}
// factory stack with a red aviation light, tower crane
put(`<path d="M318 250 L330 250 L338 ${GROUND} L310 ${GROUND} Z" fill="#20262b"/><rect x="316" y="268" width="16" height="5" fill="#2c3338"/><rect x="314" y="300" width="20" height="5" fill="#2c3338"/><circle cx="324" cy="248" r="2.4" fill="#ff5a3c" fill-opacity=".85"/><circle cx="324" cy="248" r="9" fill="#ff5a3c" fill-opacity=".12"/>`)
put(`<g stroke="#20272c" stroke-width="3" fill="none"><path d="M1660 ${GROUND} V230 M1676 ${GROUND} V230"/><path d="M1660 250 L1676 270 L1660 290 L1676 310 L1660 330 L1676 350 L1660 370 L1676 390 L1660 410 L1676 430 L1660 450 L1676 470 L1660 490 L1676 510" stroke-width="1.6"/><path d="M1540 232 H1900 M1540 244 H1900" stroke-width="2.4"/><path d="M1668 212 L1560 232 M1668 212 L1880 232" stroke-width="1.4"/><path d="M1820 244 V296" stroke-width="1"/></g><rect x="1646" y="236" width="24" height="18" fill="#20272c"/><rect x="1812" y="296" width="18" height="8" fill="#20272c"/><circle cx="1668" cy="210" r="2" fill="#ff5a3c" fill-opacity=".8"/>`)
// power line pylons
for (const px of [80, 700]) put(`<g stroke="#1e2428" stroke-width="2" fill="none"><path d="M${px - 26} ${GROUND - 60} L${px} 330 L${px + 26} ${GROUND - 60} M${px - 34} 360 H${px + 34} M${px - 26} 390 H${px + 26} M${px - 14} 440 L${px + 14} 480 M${px + 14} 440 L${px - 14} 480"/></g>`)
put(`<path d="M-10 364 Q390 420 700 360 T1500 372" stroke="#1e2428" stroke-width="1.2" fill="none"/><path d="M-10 392 Q390 446 700 388 T1500 400" stroke="#1e2428" stroke-width="1.2" fill="none"/>`)
put(`<rect x="0" y="300" width="${W}" height="${GROUND - 300}" fill="url(#haze)"/>`)

// ---------- scrapyard heaps behind the fence ----------
const rust = ['#4a3122', '#553624', '#3e2a1f', '#5b3b27', '#3a302a', '#32302d', '#434b44', '#3a4452', '#4d4a3c']
function carBody(x, y, w, rot, col, wheels = true) {
  const h = w * 0.34
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})"><path d="M0 ${f(h)} L0 ${f(h * 0.45)} Q${f(w * 0.02)} ${f(h * 0.3)} ${f(w * 0.18)} ${f(h * 0.28)} L${f(w * 0.3)} 0 L${f(w * 0.68)} 0 L${f(w * 0.8)} ${f(h * 0.28)} Q${f(w * 0.98)} ${f(h * 0.32)} ${f(w)} ${f(h * 0.5)} L${f(w)} ${f(h)} Z" fill="${col}"/><path d="M${f(w * 0.33)} ${f(h * 0.06)} L${f(w * 0.48)} ${f(h * 0.06)} L${f(w * 0.48)} ${f(h * 0.28)} L${f(w * 0.24)} ${f(h * 0.28)} Z M${f(w * 0.51)} ${f(h * 0.06)} L${f(w * 0.66)} ${f(h * 0.06)} L${f(w * 0.76)} ${f(h * 0.28)} L${f(w * 0.51)} ${f(h * 0.28)} Z" fill="#0d0c0b"/>${wheels ? `<circle cx="${f(w * 0.2)}" cy="${f(h)}" r="${f(h * 0.3)}" fill="#0e0d0c"/><circle cx="${f(w * 0.8)}" cy="${f(h)}" r="${f(h * 0.3)}" fill="#0e0d0c"/>` : `<path d="M${f(w * 0.1)} ${f(h)} a${f(h * 0.3)} ${f(h * 0.3)} 0 0 1 ${f(h * 0.6)} 0 Z M${f(w * 0.7)} ${f(h)} a${f(h * 0.3)} ${f(h * 0.3)} 0 0 1 ${f(h * 0.6)} 0 Z" fill="#0b0a09"/>`}<path d="M0 ${f(h * 0.45)} H${f(w)}" stroke="#000" stroke-opacity=".35" stroke-width="2"/><path d="M${f(w * 0.3)} 0 H${f(w * 0.68)}" stroke="#e8b27a" stroke-opacity=".22" stroke-width="1.4"/></g>`
}
function tyre(x, y, rr, squash = 0.45) {
  return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rr)}" ry="${f(rr * squash)}" fill="#141312"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rr * 0.5)}" ry="${f(rr * squash * 0.5)}" fill="#070707"/><path d="M${f(x - rr)} ${f(y)} A${f(rr)} ${f(rr * squash)} 0 0 1 ${f(x + rr)} ${f(y)}" stroke="#5a5048" stroke-opacity=".35" stroke-width="1.2" fill="none"/>`
}
function barrel(x, y, w, col, tilt = 0) {
  const h = w * 1.4
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(tilt)})"><rect x="${f(-w / 2)}" y="${f(-h)}" width="${f(w)}" height="${f(h)}" rx="2" fill="${col}"/><rect x="${f(-w / 2)}" y="${f(-h * 0.7)}" width="${f(w)}" height="2" fill="#000" fill-opacity=".4"/><rect x="${f(-w / 2)}" y="${f(-h * 0.35)}" width="${f(w)}" height="2" fill="#000" fill-opacity=".4"/><rect x="${f(-w / 2)}" y="${f(-h)}" width="${f(w * 0.22)}" height="${f(h)}" fill="#fff" fill-opacity=".05"/><rect x="${f(w * 0.25)}" y="${f(-h)}" width="${f(w * 0.25)}" height="${f(h)}" fill="#000" fill-opacity=".3"/></g>`
}
// heap silhouettes (base mass), then pieces on them
const heaps = [[420, 404, 560], [940, 380, 480], [1420, 396, 540], [1800, 452, 360]]
for (const [cx, top, w] of heaps) {
  // ragged silhouette: a bell-shaped mass broken up by jutting sheets, pipes and car roofs
  let d = `M${cx - w / 2} ${GROUND}`
  for (let x = cx - w / 2; x <= cx + w / 2; x += r(6, 18)) {
    const t = (x - cx) / (w / 2)
    const bell = Math.exp(-t * t * 2.2) - Math.exp(-2.2) * (1 - Math.abs(t))
    let y = GROUND - (GROUND - top) * bell * r(0.86, 1.04)
    if (rnd() < 0.12) y -= r(8, 22)
    d += ` L${f(x)} ${f(y)}`
  }
  put(`<path d="${d} L${cx + w / 2} ${GROUND} Z" fill="#221d19"/>`)
  let pieces = ''
  for (let i = 0; i < 44; i++) {
    const t = rnd(), x = cx - w / 2 + t * w
    const hy = top + Math.pow(Math.abs(t - 0.5) * 2, 1.6) * (GROUND - top) * 0.9 + r(-6, 30)
    const k = rnd()
    if (k < 0.2) pieces += carBody(x - 50, hy - 20, r(80, 130), r(-24, 24), pick(rust))
    else if (k < 0.5) pieces += tyre(x, hy, r(10, 18), r(.3, .95))
    else if (k < 0.62) pieces += barrel(x, hy + 10, r(12, 18), pick(rust), r(-60, 60))
    else if (k < 0.88) pieces += `<path d="M${f(x)} ${f(hy)} l${f(r(20, 60))} ${f(r(-18, 8))} l${f(r(-6, 10))} ${f(r(14, 30))} l${f(r(-50, -20))} ${f(r(-4, 8))} Z" fill="${pick(rust)}"/><path d="M${f(x)} ${f(hy)} l${f(r(20, 50))} ${f(r(-18, 4))}" stroke="#d99a60" stroke-opacity=".16" stroke-width="1"/>`
    else pieces += `<path d="M${f(x)} ${f(hy)} l${f(r(-50, 50))} ${f(r(-40, -10))}" stroke="${pick(['#3a3430', '#2a2724', '#4a3a2c'])}" stroke-width="${f(r(2, 5))}" stroke-linecap="round"/>`
  }
  put(`<g filter="url(#rust)">${pieces}</g>`)
}
// junkyard crane (grab loader) over the right heap, a workers' trailer with a lit window
put(`<g fill="#191715"><rect x="1236" y="560" width="96" height="42" rx="4"/><rect x="1300" y="534" width="34" height="30"/><path d="M1290 548 L1380 404 L1392 410 L1306 556 Z"/><path d="M1380 404 L1440 470 L1432 476 L1376 414 Z"/><path d="M1426 474 l-12 28 l14 6 l6 -10 l6 10 l14 -6 l-12 -28 z"/></g><rect x="1306" y="540" width="22" height="16" fill="#9fb6b8" fill-opacity=".18"/><path d="M1436 474 v8" stroke="#191715" stroke-width="2"/>`)
put(`<g><rect x="690" y="548" width="120" height="58" fill="#2b2a26" filter="url(#grime)"/><rect x="686" y="542" width="128" height="8" fill="#1a1917"/><rect x="706" y="562" width="30" height="20" fill="#e0a55a" fill-opacity=".62"/><rect x="706" y="572" width="30" height="1.5" fill="#000" fill-opacity=".5"/><rect x="760" y="560" width="22" height="46" fill="#1d1c19"/></g>`)
put(`<rect x="0" y="470" width="${W}" height="${GROUND - 470}" fill="#2e3230" fill-opacity=".14"/>`)

// ---------- the ГСК's concrete fence (diamond-relief slabs) with a chain-link gate over the lane ----------
const FENCE_TOP = 572
for (let x = -10; x < W; x += 124) {
  if (x > 960 && x < 1250) continue // the gate
  put(`<g filter="url(#grime)"><rect x="${x}" y="${FENCE_TOP + r(-2, 3)}" width="122" height="${GROUND - FENCE_TOP + 10}" fill="url(#fence)"/><rect x="${x}" y="${FENCE_TOP}" width="122" height="${GROUND - FENCE_TOP + 10}" fill="url(#fencerelief)"/></g><rect x="${x + 121}" y="${FENCE_TOP - 4}" width="5" height="${GROUND - FENCE_TOP + 14}" fill="#1c1a18"/>`)
}
put(`<path d="M-10 ${FENCE_TOP - 6} ${Array.from({ length: 70 }, (_, i) => `L${i * 28} ${FENCE_TOP - 8 + (i % 2) * 4}`).join(' ')}" stroke="#6a6a64" stroke-opacity=".35" stroke-width=".8" fill="none"/>`)
put(`<g><rect x="1004" y="548" width="6" height="96" fill="#1a1918"/><rect x="1206" y="548" width="6" height="96" fill="#1a1918"/><rect x="1010" y="556" width="96" height="84" fill="url(#chain)"/><rect x="1110" y="560" width="96" height="80" fill="url(#chain)"/><path d="M1010 556 H1106 V640 H1010 Z M1110 560 H1206 V640 H1110 Z" stroke="#3a3936" stroke-width="2.4" fill="none"/><path d="M1102 596 q6 10 12 0" stroke="#7a7770" stroke-opacity=".5" stroke-width="1.6" fill="none"/></g>`)

// ---------- garage rows (front) ----------
const doorCols = ['#34453a', '#2f3e4c', '#4c3a2c', '#3f3f3c', '#3a4a3a', '#4a2f2a', '#2d3a44', '#51483a', '#374235']
function garageRow(x0, count, gw, top, wallPattern, startNo, openIdx = -1) {
  const x1 = x0 + count * gw
  // wall (brick) with grime
  put(`<g filter="url(#grime)"><rect x="${x0}" y="${top}" width="${count * gw}" height="${GROUND - top}" fill="url(#${wallPattern})"/></g>`)
  put(`<rect x="${x0}" y="${top}" width="${count * gw}" height="${GROUND - top}" fill="url(#shadeDown)"/>`)
  // flat roof slab and drooping ruberoid edge
  let edge = `M${x0 - 8} ${top - 12} H${x1 + 8} V${top + 2}`
  for (let x = x1 + 8; x > x0 - 8; x -= r(10, 26)) edge += ` L${f(x)} ${f(top + 2 + (rnd() < 0.18 ? r(4, 14) : r(0, 3)))}`
  edge += ` L${x0 - 8} ${top + 2} Z`
  put(`<path d="${edge}" fill="url(#roofedge)"/><path d="M${x0 - 8} ${top - 12} H${x1 + 8}" stroke="#6a6258" stroke-opacity=".35" stroke-width="1.2"/>`)
  for (let i = 0; i < count; i++) {
    const gx = x0 + i * gw
    // separating pilaster
    put(`<rect x="${gx - 3}" y="${top + 2}" width="6" height="${GROUND - top - 2}" fill="#000" fill-opacity=".3"/>`)
    const dw = gw * 0.76, dx = gx + (gw - dw) / 2, dy = top + 26, dh = GROUND - dy - 4
    // steel lintel
    put(`<rect x="${f(dx - 6)}" y="${f(dy - 8)}" width="${f(dw + 12)}" height="8" fill="#2b2826"/><rect x="${f(dx - 6)}" y="${f(dy - 8)}" width="${f(dw + 12)}" height="1.4" fill="#8b7a66" fill-opacity=".25"/>`)
    if (i === openIdx) {
      // an open box: warm bulb light, a car's rear, shelves with jars, a figure-free workbench
      put(`<rect x="${f(dx)}" y="${f(dy)}" width="${f(dw)}" height="${f(dh)}" fill="url(#inside)"/>`)
      put(`<g fill="#3a2410" fill-opacity=".85"><rect x="${f(dx + 6)}" y="${f(dy + 14)}" width="${f(dw * 0.3)}" height="3"/><rect x="${f(dx + 6)}" y="${f(dy + 34)}" width="${f(dw * 0.3)}" height="3"/>${Array.from({ length: 5 }, (_, k) => `<rect x="${f(dx + 8 + k * 7)}" y="${f(dy + 5)}" width="5" height="9" rx="1"/>`).join('')}</g>`)
      put(`<path d="M${f(dx + dw * 0.18)} ${f(dy + dh)} V${f(dy + dh * 0.5)} Q${f(dx + dw * 0.2)} ${f(dy + dh * 0.36)} ${f(dx + dw * 0.34)} ${f(dy + dh * 0.34)} H${f(dx + dw * 0.72)} Q${f(dx + dw * 0.84)} ${f(dy + dh * 0.36)} ${f(dx + dw * 0.86)} ${f(dy + dh * 0.5)} V${f(dy + dh)} Z" fill="#1a120b"/><rect x="${f(dx + dw * 0.22)}" y="${f(dy + dh * 0.58)}" width="${f(dw * 0.12)}" height="6" fill="#b0301c" fill-opacity=".8"/><rect x="${f(dx + dw * 0.7)}" y="${f(dy + dh * 0.58)}" width="${f(dw * 0.12)}" height="6" fill="#b0301c" fill-opacity=".8"/><rect x="${f(dx + dw * 0.42)}" y="${f(dy + dh * 0.66)}" width="${f(dw * 0.2)}" height="8" fill="#d8d0b8" fill-opacity=".5"/>`)
      put(`<circle cx="${f(dx + dw / 2)}" cy="${f(dy + 8)}" r="3" fill="#fff2cc"/>`)
      // open leaves swung outward (seen edge-on, foreshortened)
      put(`<path d="M${f(dx)} ${f(dy)} L${f(dx - dw * 0.22)} ${f(dy + 8)} L${f(dx - dw * 0.22)} ${f(dy + dh + 6)} L${f(dx)} ${f(dy + dh)} Z" fill="${pick(doorCols)}" filter="url(#rust)"/><path d="M${f(dx + dw)} ${f(dy)} L${f(dx + dw * 1.22)} ${f(dy + 8)} L${f(dx + dw * 1.22)} ${f(dy + dh + 6)} L${f(dx + dw)} ${f(dy + dh)} Z" fill="${pick(doorCols)}" filter="url(#rust)"/>`)
      // light spilling onto the lane
      put(`<path d="M${f(dx)} ${GROUND} L${f(dx + dw)} ${GROUND} L${f(dx + dw * 1.7)} ${H} L${f(dx - dw * 0.7)} ${H} Z" fill="url(#spill)"/>`)
      continue
    }
    const col = doorCols[(i * 5 + startNo) % doorCols.length]
    put(`<g filter="url(#rust)"><rect x="${f(dx)}" y="${f(dy)}" width="${f(dw / 2 - 1)}" height="${f(dh)}" fill="${col}"/><rect x="${f(dx + dw / 2 + 1)}" y="${f(dy)}" width="${f(dw / 2 - 1)}" height="${f(dh)}" fill="${col}"/></g>`)
    // welded angle-iron frame on each leaf: two horizontal stiffeners and a highlight along the top edge
    put(`<g stroke="#000" stroke-opacity=".38" stroke-width="2.2"><path d="M${f(dx + 3)} ${f(dy + dh * 0.33)} H${f(dx + dw - 3)} M${f(dx + 3)} ${f(dy + dh * 0.7)} H${f(dx + dw - 3)}"/></g><path d="M${f(dx + 3)} ${f(dy + dh * 0.33 - 2)} H${f(dx + dw - 3)} M${f(dx + 2)} ${f(dy + 2)} H${f(dx + dw - 2)}" stroke="#e8c79a" stroke-opacity=".12" stroke-width="1"/><rect x="${f(dx)}" y="${f(dy)}" width="${f(dw)}" height="${f(dh)}" fill="url(#shadeDown)"/>`)
    put(`<rect x="${f(dx)}" y="${f(dy)}" width="${f(dw)}" height="${f(dh)}" fill="none" stroke="#0b0a09" stroke-width="2.2"/><path d="M${f(dx + dw / 2)} ${f(dy)} V${f(dy + dh)}" stroke="#0b0a09" stroke-width="2.4"/>`)
    // hinges, a hasp with a padlock, sometimes a wicket door cut into the left leaf
    put(`<rect x="${f(dx - 4)}" y="${f(dy + 12)}" width="6" height="4" fill="#1b1917"/><rect x="${f(dx - 4)}" y="${f(dy + dh - 18)}" width="6" height="4" fill="#1b1917"/><rect x="${f(dx + dw - 2)}" y="${f(dy + 12)}" width="6" height="4" fill="#1b1917"/><rect x="${f(dx + dw - 2)}" y="${f(dy + dh - 18)}" width="6" height="4" fill="#1b1917"/>`)
    put(`<rect x="${f(dx + dw / 2 - 7)}" y="${f(dy + dh * 0.5)}" width="14" height="3" fill="#1e1c1a"/><rect x="${f(dx + dw / 2 - 3)}" y="${f(dy + dh * 0.5 + 3)}" width="6" height="7" rx="1" fill="#5c5448"/>`)
    if (rnd() < 0.45) put(`<rect x="${f(dx + 6)}" y="${f(dy + dh * 0.22)}" width="${f(dw / 2 - 14)}" height="${f(dh * 0.74)}" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1.6"/>`)
    // painted box number (white stencil, weathered)
    const no = startNo + i
    put(`<text x="${f(dx + dw * 0.75)}" y="${f(dy + 26)}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="${f(gw * 0.16)}" fill="#d9d1bd" fill-opacity="${f(r(.35, .55))}">${no}</text>`)
    // rust run-off under the lintel
    put(`<rect x="${f(dx + r(4, dw - 10))}" y="${f(dy)}" width="3" height="${f(r(20, 60))}" fill="#5a3218" fill-opacity=".35" filter="url(#soft)"/>`)
  }
  // roof clutter: tyres, an old boat hull, a TV aerial, a satellite dish
  for (let i = 0; i < count; i += 1 + Math.floor(rnd() * 3)) {
    const gx = x0 + i * gw + r(10, gw - 30), k = rnd()
    if (k < 0.35) put(tyre(gx, top - 14, 13, 0.34) + tyre(gx + 4, top - 20, 13, 0.34))
    else if (k < 0.55) put(`<path d="M${f(gx)} ${top - 12} V${top - 52} M${f(gx - 16)} ${top - 46} H${f(gx + 16)} M${f(gx - 11)} ${top - 38} H${f(gx + 11)} M${f(gx - 7)} ${top - 30} H${f(gx + 7)}" stroke="#171513" stroke-width="1.8"/>`)
    else if (k < 0.7) put(`<path d="M${f(gx)} ${top - 12} q-4 -18 14 -24 a16 16 0 0 1 4 26 z" fill="#3d3a36"/><path d="M${f(gx + 6)} ${top - 26} l10 -4" stroke="#171513" stroke-width="1.4"/>`)
    else if (k < 0.8) put(`<path d="M${f(gx - 20)} ${top - 12} Q${f(gx + 20)} ${top - 34} ${f(gx + 60)} ${top - 12} Z" fill="#2c3a44"/>`)
  }
  // weeds at the foot of the wall
  let weeds = ''
  for (let x = x0; x < x1; x += r(3, 9)) weeds += `M${f(x)} ${GROUND} q${f(r(-4, 4))} ${f(-r(4, 18))} ${f(r(-6, 6))} ${f(-r(8, 26))} `
  put(`<path d="${weeds}" stroke="#2a2a1c" stroke-width="1.2" fill="none"/>`)
}
garageRow(-30, 8, 128, 486, 'brick', 11, 5)
garageRow(1252, 3, 124, 494, 'silicate', 41, -1)
// scrapyard spilling out past the last boxes: flattened cars stacked three high against the fence, tyres, a skip
{
  let pile = ''
  for (let row = 0; row < 3; row++) for (let x = 1640 + row * 18; x < 1960; x += r(110, 140)) {
    const y = GROUND - 28 - row * 30 + r(-3, 3)
    pile += `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(r(-5, 5))})"><path d="M0 26 L4 8 L30 4 L40 -2 L86 -2 L98 6 L118 10 L120 26 Z" fill="${pick(rust)}"/><path d="M42 1 L84 1 L90 8 L36 8 Z" fill="#0c0b0a"/><path d="M0 16 H120" stroke="#000" stroke-opacity=".4" stroke-width="2"/><path d="M30 4 L40 -2 L86 -2" stroke="#e8b27a" stroke-opacity=".2" stroke-width="1.2" fill="none"/></g>`
  }
  put(`<g filter="url(#rust)">${pile}</g>`)
  put(`<g filter="url(#rust)"><path d="M1600 ${GROUND + 8} L1612 ${GROUND - 40} L1700 ${GROUND - 40} L1712 ${GROUND + 8} Z" fill="#3d4a3c"/></g><path d="M1606 ${GROUND - 16} H1706" stroke="#000" stroke-opacity=".35" stroke-width="2"/>`)
  put(tyre(1760, GROUND + 12, 20, 0.4) + tyre(1800, GROUND + 18, 22, 0.4) + tyre(1780, GROUND + 4, 20, 0.4))
}
// a hand-painted cooperative sign on the gate post
put(`<g transform="translate(962 528) rotate(-2)"><rect width="84" height="34" fill="#c9c2ae" fill-opacity=".72"/><rect width="84" height="34" fill="none" stroke="#1a1917" stroke-width="2"/><text x="42" y="24" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="17" fill="#22354f" fill-opacity=".9">ГСК-14</text></g><rect x="998" y="562" width="4" height="80" fill="#1a1918"/>`)

// ---------- lane, puddles, lamp, wires ----------
put(`<rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="url(#asphalt)"/>`)
put(`<rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="#3a3632" filter="url(#cracks)" opacity=".5"/>`)
put(`<rect x="0" y="${GROUND}" width="${W}" height="6" fill="#000" fill-opacity=".55"/>`)
put(`<path d="M${LAMP.x - 16} ${H} V${LAMP.y + 6}" stroke="#2c2a27" stroke-width="10"/><path d="M${LAMP.x - 18} ${H} V${LAMP.y + 6}" stroke="#4a463f" stroke-opacity=".5" stroke-width="2"/><path d="M${LAMP.x - 16} ${LAMP.y + 8} Q${LAMP.x - 16} ${LAMP.y - 4} ${LAMP.x + 6} ${LAMP.y - 4}" stroke="#2c2a27" stroke-width="4" fill="none"/><path d="M${LAMP.x - 2} ${LAMP.y - 8} h28 l-5 8 h-18 z" fill="#1c1b19"/>`)
put(`<path d="M${LAMP.x} ${LAMP.y} L${LAMP.x + 22} ${LAMP.y} L${LAMP.x + 170} ${H} L${LAMP.x - 150} ${H} Z" fill="url(#cone)"/>`)
put(`<ellipse cx="${LAMP.x + 11}" cy="${LAMP.y}" rx="240" ry="240" fill="url(#lampglow)"/><rect x="${LAMP.x + 2}" y="${LAMP.y}" width="18" height="3" fill="#fff0c8"/>`)
put(`<ellipse cx="${LAMP.x + 10}" cy="${GROUND + 70}" rx="260" ry="60" fill="url(#pool)"/>`)
put(`<path d="M${LAMP.x - 16} ${LAMP.y + 20} Q${LAMP.x - 300} ${LAMP.y + 70} 560 ${486 - 14}" stroke="#101010" stroke-width="1.2" fill="none"/><path d="M${LAMP.x - 16} ${LAMP.y + 26} Q${LAMP.x + 200} ${LAMP.y + 80} 1500 ${494 - 12}" stroke="#101010" stroke-width="1.2" fill="none"/>`)
// puddles reflecting the lamp and the open box
for (const [cx, cy, rx] of [[1060, 690, 120], [1260, 716, 70], [640, 704, 90], [300, 682, 60], [1700, 700, 90]]) {
  put(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${f(rx * 0.12)}" fill="#0e1214"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${f(rx * 0.12)}" fill="#7fa8b0" fill-opacity=".08"/>`)
}
put(`<rect x="${LAMP.x + 4}" y="682" width="14" height="22" fill="#ffd79a" fill-opacity=".35" filter="url(#blur3)"/><rect x="656" y="696" width="40" height="10" fill="#e9a45c" fill-opacity=".25" filter="url(#blur3)"/>`)

// ---------- foreground: a stripped Zhiguli-style wreck on bricks, a tyre stack, a burning barrel ----------
put(`<ellipse cx="1410" cy="700" rx="130" ry="10" fill="#000" fill-opacity=".55" filter="url(#blur3)"/>`)
put(`<g filter="url(#rust)">${carBody(1300, 612, 220, 1.5, '#4b3d2c', false)}</g>`)
put(`<rect x="1330" y="686" width="18" height="12" fill="#3a2418"/><rect x="1480" y="690" width="18" height="12" fill="#3a2418"/>`)
put(`<g>${tyre(210, 700, 30, 0.34)}${tyre(214, 684, 30, 0.34)}${tyre(208, 668, 30, 0.34)}${tyre(260, 712, 26, 0.34)}</g>`)
put(`<ellipse cx="${FIRE.x}" cy="${FIRE.y - 40}" rx="170" ry="140" fill="url(#fireglow)"/>`)
put(barrel(FIRE.x, FIRE.y + 30, 34, '#3a2a1e'))
put(`<path d="M${FIRE.x - 14} ${FIRE.y - 18} q4 -22 10 -30 q2 14 8 6 q4 -12 2 -22 q14 16 8 46 z" fill="#ffb14a" fill-opacity=".9" filter="url(#soft)"/><path d="M${FIRE.x - 6} ${FIRE.y - 18} q2 -12 6 -18 q4 10 4 18 z" fill="#fff0b0" fill-opacity=".9"/>`)
put(`<path d="M${FIRE.x - 4} ${FIRE.y - 50} q-20 -40 10 -80 q24 -30 0 -80" stroke="#4a4540" stroke-opacity=".25" stroke-width="16" fill="none" filter="url(#blur3)"/>`)
put(`<rect x="${FIRE.x - 17}" y="${FIRE.y - 20}" width="34" height="10" fill="#ff9a3a" fill-opacity=".35"/>`)
// rim light on the wreck from the fire
put(`<path d="M1520 626 L1550 646" stroke="#ffae5a" stroke-opacity=".35" stroke-width="2"/>`)

// ---------- atmosphere: low mist over the lane, a cool fall-off at the far left/right ----------
put(`<rect x="0" y="${GROUND - 70}" width="${W}" height="140" fill="#5b5a55" fill-opacity=".08" filter="url(#blur3)"/>`)
put(`</svg>`)

const svg = out.join('\n')
if (process.argv.includes('--svg')) fs.writeFileSync(path.join(os.tmpdir(), 'gsk-junkyard.svg'), svg)
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: OUT_W / W })
await p.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`)
const png = await p.locator('svg').screenshot({ omitBackground: true })
await b.close()
const file = new URL('../../../src/assets/textures/telnyashka/gsk-junkyard.webp', import.meta.url).pathname
const info = await sharp(png).webp({ quality: 70, alphaQuality: 80, effort: 6 }).toFile(file)
console.log(file, info.width, info.height, info.size)
