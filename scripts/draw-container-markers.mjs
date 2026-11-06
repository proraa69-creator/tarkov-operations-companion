// Draws the loot containers' map markers in the style of src/assets/map-markers-new (owner, 06.11.2026: «иконки… еле видно на карте.
// Переделай их все под наш стиль, прям возьми, как трафарет перерисуй»): a dark outline, a lit rim and a few scratches on each
// part, each thing's real shape and colours taken from the game. Run: node scripts/draw-container-markers.mjs
import { mkdirSync, writeFileSync } from 'node:fs'

const OUTLINE = '#161a17'
const mix = (hex, other, share) => {
  const channel = (value, at) => parseInt(value.slice(at, at + 2), 16)
  const parts = [1, 3, 5].map((at) => Math.round(channel(hex, at) * (1 - share) + channel(other, at) * share))
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`
}

/** A part with an outline, a lit top-left rim and scratches. */
const part = (d, fill, scratches = [], width = 3) => ({ type: 'part', d, fill, scratches, width })
/** A small detail: flat colour with a thin outline. */
const flat = (d, fill, width = 1.6) => ({ type: 'flat', d, fill, width })
/** A line drawn on what is under it. */
const line = (d, color = OUTLINE, width = 2) => ({ type: 'line', d, color, width })
/** A handle, a strap or a limb: a thick line with an outline. */
const band = (d, color, width = 4) => ({ type: 'band', d, color, width })

const rect = (x, y, w, h) => `M${x} ${y} H${x + w} V${y + h} H${x} Z`
const circle = (x, y, r) => `M${x - r} ${y} A${r} ${r} 0 1 1 ${x + r} ${y} A${r} ${r} 0 1 1 ${x - r} ${y} Z`
const redCross = (x, y, size) => [flat(`M${x - size / 3} ${y - size} H${x + size / 3} V${y - size / 3} H${x + size} V${y + size / 3} H${x + size / 3} V${y + size} H${x - size / 3} V${y + size / 3} H${x - size} V${y - size / 3} H${x - size / 3} Z`, '#c8362c', 0)]

/** The wooden supply crate of the game: planks, braces in an X, a white label saying what it holds. */
const supplyCrate = (label) => [
  part('M2 11 L9 5 H39 L46 11 V16 H2 Z', '#d7c083', ['M12 8 L16 7']),
  part(rect(4, 15, 40, 28), '#c9b070', ['M12 39 L18 36']),
  line('M4 22 H44', '#6d5c33', 1), line('M4 29 H44', '#6d5c33', 1), line('M4 36 H44', '#6d5c33', 1),
  flat(rect(4, 15, 5, 28), '#e0cb92'), flat(rect(21.5, 15, 5, 28), '#e0cb92'), flat(rect(39, 15, 5, 28), '#e0cb92'),
  line('M9 42 L21.5 16', OUTLINE, 2.2), line('M26.5 42 L39 16', OUTLINE, 2.2),
  flat(rect(27, 17, 11, 11), '#f4f1e4', 1.5),
  ...label,
]

/** A body on the ground: head, torso, legs and arms, in the clothes of who it was, and blood under it. */
const body = ({ clothes, legs, head, extra = [] }) => [
  flat('M26 32 C34 28 44 32 44 39 C44 45 32 46 26 42 Z', '#b0342a', 0),
  band('M27 27 L44 32', legs, 6.5),
  band('M24 31 L34 44', legs, 6.5),
  band('M13 21 L5 31', clothes, 5),
  band('M21 13 L33 9', clothes, 5),
  part('M9 19 L19 11 L31 24 L22 34 Z', clothes, ['M15 24 L21 28']),
  ...extra,
  part(circle(10.5, 10.5, 7), head, [], 2.8),
]

const KINDS = {
  safe: [
    flat(rect(10, 42, 6, 4), '#50544f'), flat(rect(32, 42, 6, 4), '#50544f'),
    part(rect(7, 4, 34, 39), '#a9ada8', ['M11 38 L17 35']),
    flat(rect(39, 9, 5, 8), '#6e736e'), flat(rect(39, 30, 5, 8), '#6e736e'),
    line(rect(11, 8, 26, 31), OUTLINE, 1.6),
    flat(rect(14, 19, 12, 10), '#f2f1e9', 1.6),
    flat(circle(28, 24, 7.5), '#f2f1e9', 2),
    flat(circle(28, 24, 3.4), '#3a3e3b', 1.2),
    line('M17 24 H22', OUTLINE, 1.8),
  ],
  'cash-register': [
    part('M3 26 L10 19 H38 L45 26 V43 H3 Z', '#c9cdc6', ['M8 39 L14 36']),
    line('M3 33 H45', OUTLINE, 2),
    flat(circle(24, 38, 2.6), '#7e8480', 1.4),
    part('M10 21 L13 11 H35 L38 21 Z', '#e4e6df', [], 2.6),
    flat('M16 6 H32 L34 12 H14 Z', '#7fb0a2', 2),
    line('M17 15 H21', OUTLINE, 2), line('M24 15 H27', OUTLINE, 2), line('M30 15 H32', OUTLINE, 2),
    line('M16 18 H20', OUTLINE, 2), line('M23 18 H26', OUTLINE, 2), line('M29 18 H33', OUTLINE, 2),
  ],
  jacket: [
    part('M10 12 L4 30 L10.5 33 L14 23 Z', '#4f94bb'),
    part('M38 12 L44 30 L37.5 33 L34 23 Z', '#4f94bb'),
    flat('M5.5 25.5 L11.5 27.8 L10.2 31.5 L4.5 29.2 Z', '#f4f3ea', 1.2),
    flat('M42.5 25.5 L36.5 27.8 L37.8 31.5 L43.5 29.2 Z', '#f4f3ea', 1.2),
    part('M14 8 L24 12 L34 8 L38 13 L35 44 H13 L10 13 Z', '#5ba6cf', ['M17 40 L22 37', 'M27 40 L32 36']),
    flat('M12.5 24 H35.5 L35.1 29 H12.9 Z', '#f4f3ea', 1.4),
    line('M24 12 V44', OUTLINE, 2),
    flat('M15 8 L18 3 H30 L33 8 L24 13 Z', '#3c7699', 2.2),
  ],
  'duffle-bag': [
    band('M15 16 C15 6 33 6 33 16', '#3d3e39', 3.6),
    part('M4 22 C4 17 9 15 13 15 H35 C39 15 44 17 44 22 V38 C44 41 42 42 39 42 H9 C6 42 4 41 4 38 Z', '#55564f', ['M16 38 L22 35']),
    flat('M4 22 C4 18 7 16 11 15.3 V42 H9 C6 42 4 41 4 38 Z', '#dd5a2b', 2),
    flat('M44 22 C44 18 41 16 37 15.3 V42 H39 C42 42 44 41 44 38 Z', '#dd5a2b', 2),
    flat(rect(15, 27, 18, 9), '#ecebe0', 1.6),
    line('M18 30 H30', '#dd5a2b', 2), line('M18 33 H26', OUTLINE, 1.6),
    line('M11 20 H37', '#dd5a2b', 1.6),
  ],
  medbag: [
    band('M14 15 C14 6 34 6 34 15', '#39403c', 3.6),
    part('M4 19 C4 15 7 14 10 14 H38 C41 14 44 15 44 19 V41 C44 42 43 43 42 43 H6 C5 43 4 42 4 41 Z', '#e2692e', ['M9 37 L14 34']),
    line('M4 21 H44', OUTLINE, 2),
    flat(rect(10, 24, 28, 13), '#f08a4e', 1.6),
    flat(rect(4, 37.5, 40, 5.5), '#f4f3ea', 1.6),
    flat(circle(24, 30.5, 5.6), '#2a5b8f', 1.4),
    line('M24 26.8 V34.2', '#f4f3ea', 1.8), line('M20.8 28.6 L27.2 32.4', '#f4f3ea', 1.8), line('M27.2 28.6 L20.8 32.4', '#f4f3ea', 1.8),
  ],
  medcase: [
    band('M16 14 V9 C16 7 18 6 20 6 H28 C30 6 32 7 32 9 V14', '#d39a4d', 3.4),
    part('M4 17 C4 14 6 13 9 13 H39 C42 13 44 14 44 17 V40 C44 42 42 43 40 43 H8 C6 43 4 42 4 40 Z', '#d39a4d', ['M8 39 L13 36', 'M36 40 L41 36']),
    line('M4 31 H44', OUTLINE, 2.2),
    flat(rect(7, 29, 5, 4), '#f1d9a6', 1.2), flat(rect(36, 29, 5, 4), '#f1d9a6', 1.2),
    flat(circle(24, 22, 7.2), '#f6f4ea', 1.8),
    ...redCross(24, 22, 4.6),
  ],
  toolbox: [
    band('M17 14 V8 H31 V14', '#bfc08a', 3.4),
    part('M3 20 C3 16 6 14 9 14 H39 C42 14 45 16 45 20 V25 H3 Z', '#71756e', ['M8 17 L13 16']),
    part(rect(6, 25, 36, 18), '#5b5e58', ['M9 40 L13 38']),
    flat(rect(13, 28, 22, 13), '#b9bbb1', 1.6),
    flat(rect(13, 32, 22, 4.6), '#e6bd45', 1.2),
    flat(rect(5, 21, 7, 9), '#c9ca8f', 1.8), flat(rect(36, 21, 7, 9), '#c9ca8f', 1.8), flat(rect(19.5, 18, 9, 7), '#c9ca8f', 1.8),
  ],
  'pc-block': [
    part('M7 8 L14 3 V45 L7 41 Z', '#6d716e'),
    part(rect(14, 3, 25, 42), '#9ea29f', ['M18 42 L22 40']),
    flat(rect(18, 7, 17, 15), '#f3f2ea', 1.6),
    line('M18 12 H35', OUTLINE, 1.2), line('M18 17 H35', OUTLINE, 1.2),
    line('M18 27 H35', OUTLINE, 1.8), line('M18 32 H35', OUTLINE, 1.8), line('M18 37 H35', OUTLINE, 1.8),
    flat(circle(9.6, 18, 1), '#2b2e2c', 0), flat(circle(9.6, 23, 1), '#2b2e2c', 0), flat(circle(9.6, 28, 1), '#2b2e2c', 0),
  ],
  drawer: [
    part(rect(9, 7, 30, 38), '#8d9692', ['M13 42 L17 40']),
    part(rect(7, 3, 34, 5), '#a9b1ad', [], 2.6),
    line('M9 20 H39', OUTLINE, 2.4), line('M9 33 H39', OUTLINE, 2.4),
    line(rect(12, 10, 24, 8), OUTLINE, 1.2), line(rect(12, 23, 24, 8), OUTLINE, 1.2), line(rect(12, 36, 24, 7), OUTLINE, 1.2),
    flat(rect(19, 12, 10, 3.6), '#f0efe6', 1.3), flat(rect(19, 25, 10, 3.6), '#f0efe6', 1.3), flat(rect(19, 38, 10, 3.2), '#f0efe6', 1.3),
  ],
  'plastic-suitcase': [
    band('M18 8 V4 H30 V8', '#3c403c', 3),
    flat(circle(12, 44, 2.6), '#2b2e2c', 1.2), flat(circle(36, 44, 2.6), '#2b2e2c', 1.2),
    part('M7 11 C7 9 9 7 11 7 H37 C39 7 41 9 41 11 V39 C41 41 39 43 37 43 H11 C9 43 7 41 7 39 Z', '#c0c4c3', ['M11 39 L15 36', 'M33 39 L37 36']),
    flat(rect(11.5, 11, 5, 28), '#8f9493', 1.2), flat(rect(21.5, 11, 5, 28), '#8f9493', 1.2), flat(rect(31.5, 11, 5, 28), '#8f9493', 1.2),
  ],
  'weapon-box': [
    part('M3 17 L12 8 H45 L36 17 Z', '#b6c36e', ['M18 12 L24 11']),
    part('M36 17 L45 8 V33 L36 42 Z', '#6f7d3c'),
    part(rect(3, 17, 33, 25), '#94a255', ['M7 38 L12 35']),
    line('M12 8 L8 17', OUTLINE, 1.4), line('M24 8 L20 17', OUTLINE, 1.4), line('M36 8 L32 17', OUTLINE, 1.4),
    flat(rect(7, 15, 4.5, 7), '#eeeee2', 1.3), flat(rect(17.5, 15, 4.5, 7), '#eeeee2', 1.3), flat(rect(28, 15, 4.5, 7), '#eeeee2', 1.3),
    line(rect(8, 25, 23, 12), OUTLINE, 1.4),
  ],
  'grenade-box': [
    part('M7 20 L13 11 H35 L41 20 Z', '#d3cb92', ['M17 15 L22 14']),
    part(rect(3, 20, 42, 23), '#bdb67c', ['M12 40 L17 38']),
    flat(rect(3, 20, 7, 23), '#8c7d49', 2), flat(rect(38, 20, 7, 23), '#8c7d49', 2),
    flat(circle(24, 32.5, 6.8), '#5c7036', 1.8),
    flat(rect(21.5, 22.5, 5, 4), '#3e4b25', 1.2),
    line('M26.5 24 L33 28', OUTLINE, 2.2),
    line('M24 26.5 V39', OUTLINE, 1), line('M18 32.5 H30', OUTLINE, 1),
  ],
  'wooden-ammo-box': [
    part('M9 19 L14 10 H34 L39 19 Z', '#e0c27c', ['M18 14 L24 13']),
    line('M19 10 L16 19', OUTLINE, 1.6), line('M29 10 L32 19', OUTLINE, 1.6),
    part(rect(4, 19, 40, 24), '#c9a55d', ['M9 40 L14 37']),
    flat('M11 27 H26 L34 31 L26 35 H11 Z', '#f0d26b', 1.8),
    line('M21 27 V35', OUTLINE, 1.6),
  ],
  'wooden-crate': [
    part('M8 17 L13 8 H35 L40 17 Z', '#b1c672', ['M18 12 L23 11']),
    part(rect(3, 17, 42, 26), '#93aa58', ['M15 40 L20 38']),
    line('M3 25 H45', '#4f5f2c', 1.2), line('M3 34 H45', '#4f5f2c', 1.2),
    flat(rect(11, 17, 6, 26), '#c2d486', 1.8), flat(rect(31, 17, 6, 26), '#c2d486', 1.8),
    flat(rect(11.5, 21, 5, 7), '#7c8169', 1.4), flat(rect(31.5, 21, 5, 7), '#7c8169', 1.4),
  ],
  'technical-supply-crate': supplyCrate([flat(circle(32.5, 22.5, 3.6), '#5f6a72', 1.4), flat(circle(32.5, 22.5, 1.2), '#f4f1e4', 0)]),
  'medical-supply-crate': supplyCrate(redCross(32.5, 22.5, 3.8)),
  'ration-supply-crate': supplyCrate([flat(rect(29.5, 19.5, 6, 6.6), '#c9553b', 1.3), line('M29.5 22 H35.5', '#f4f1e4', 1.2)]),
  'buried-barrel-cache': [
    part('M9 19 H39 L36 41 C31 44 17 44 12 41 Z', '#4a95c9', ['M15 38 L20 36']),
    flat('M9.2 22 H38.8 L38.2 27 H9.8 Z', '#f0efe6', 1.4),
    part('M5 15 C5 10 14 7 24 7 C34 7 43 10 43 15 C43 20 34 23 24 23 C14 23 5 20 5 15 Z', '#696e6a'),
    line('M12 15 C12 12 18 11 24 11 C30 11 36 12 36 15 C36 18 30 19 24 19 C18 19 12 18 12 15 Z', OUTLINE, 1.6),
    flat('M3 46 L7 27 L12 46 Z', '#78bf55', 1.6), flat('M13 46 L18 33 L23 46 Z', '#8fd066', 1.6), flat('M26 46 L31 35 L35 46 Z', '#78bf55', 1.6), flat('M35 46 L42 29 L46 46 Z', '#8fd066', 1.6),
  ],
  'ground-cache': [
    part('M5 37 L34 24 L38 31 L9 44 Z', '#a87a48', ['M14 38 L20 35']),
    part('M12 24 L42 36 L39 43 L9 31 Z', '#c1915a', ['M18 29 L24 31']),
    part('M4 20 C8 8 20 4 29 7 C38 6 45 13 44 22 C37 28 28 26 23 24 C16 29 8 27 4 20 Z', '#90c257', ['M12 17 L18 14', 'M29 13 L35 16']),
    line('M10 20 C18 14 28 13 38 18', '#4f7229', 1.4),
    line('M18 15 L21 20', '#4f7229', 1.2), line('M28 13 L27 19', '#4f7229', 1.2),
  ],
  'shturmans-stash': [
    band('M17 10 C17 3 31 3 31 10', '#d9c78d', 3.2),
    part(rect(5, 19, 38, 25), '#8d7f54', ['M9 41 L13 39']),
    line('M5 25 H43', OUTLINE, 1.3), line('M5 30 H43', OUTLINE, 1.3), line('M5 35 H43', OUTLINE, 1.3), line('M5 40 H43', OUTLINE, 1.3),
    part('M4 13 C4 11 6 9 8 9 H40 C42 9 44 11 44 13 V20 H4 Z', '#ad9c68', ['M9 13 L14 12']),
    flat(rect(19.5, 14, 9, 13), '#ecdca3', 1.8),
    flat(circle(24, 20.5, 1.7), '#3a2f18', 0),
  ],
  'dead-scav': body({ clothes: '#7f9a54', legs: '#5f7440', head: '#b3b7b0', extra: [line('M13 18 L24 29', '#3e4b28', 1.6)] }),
  'pmc-body': body({ clothes: '#c5b88f', legs: '#5c625c', head: '#f2f1e6', extra: [flat('M12.5 19 L19 13.5 L27.5 23 L21.5 30 Z', '#7a8466', 1.6)] }),
  'civilian-body': body({ clothes: '#e4e1d4', legs: '#6c7259', head: '#e7b58f', extra: [line('M15 17 L25 28', '#8a2a24', 2)] }),
  'lab-technician-body': body({ clothes: '#f5f6ef', legs: '#f5f6ef', head: '#e7b58f', extra: [flat(rect(18, 19, 5, 5), '#3a6f9e', 1)] }),
}

function draw(kind, parts) {
  const defs = []
  const body = parts.map((entry, index) => {
    const id = `${kind.replace(/[^a-z]/g, '')}${index}`
    if (entry.type === 'line') return `<path d="${entry.d}" fill="none" stroke="${entry.color}" stroke-width="${entry.width}" stroke-linecap="round" stroke-linejoin="round"/>`
    if (entry.type === 'band') return `<path d="${entry.d}" fill="none" stroke="${OUTLINE}" stroke-width="${entry.width + 3}" stroke-linecap="round" stroke-linejoin="round"/><path d="${entry.d}" fill="none" stroke="${entry.color}" stroke-width="${entry.width}" stroke-linecap="round" stroke-linejoin="round"/>`
    if (entry.type === 'flat') return `<path d="${entry.d}" fill="${entry.fill}"${entry.width ? ` stroke="${OUTLINE}" stroke-width="${entry.width}" stroke-linejoin="round"` : ''}/>`
    const lit = mix(entry.fill, '#ffffff', 0.42)
    const dark = mix(entry.fill, '#000000', 0.42)
    defs.push(`<mask id="${id}h" maskUnits="userSpaceOnUse" x="-24" y="-24" width="96" height="96"><path d="${entry.d}" fill="#fff"/><path d="${entry.d}" fill="#000" transform="translate(2.6 2.6)"/></mask>`)
    if (entry.scratches.length) defs.push(`<clipPath id="${id}c"><path d="${entry.d}"/></clipPath>`)
    return `<path d="${entry.d}" fill="${entry.fill}"/><path d="${entry.d}" fill="${lit}" mask="url(#${id}h)"/>`
      + (entry.scratches.length ? `<g clip-path="url(#${id}c)" fill="none" stroke="${dark}" stroke-width="0.9" stroke-linecap="round" opacity="0.8">${entry.scratches.map((d) => `<path d="${d}"/>`).join('')}</g>` : '')
      + `<path d="${entry.d}" fill="none" stroke="${OUTLINE}" stroke-width="${entry.width}" stroke-linejoin="round" stroke-linecap="round"/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">\n<defs>${defs.join('')}</defs>\n${body.join('')}\n</svg>\n`
}

const out = new URL('../src/assets/map-markers/containers/', import.meta.url)
mkdirSync(out, { recursive: true })
for (const [kind, parts] of Object.entries(KINDS)) writeFileSync(new URL(`${kind}.svg`, out), draw(kind, parts))
console.log(`${Object.keys(KINDS).length} markers`)
