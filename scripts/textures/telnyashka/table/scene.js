// Telnyashka theme — the still life at the foot of the sidebar, modelled in three.js and rendered as layers.
//
// Everything here is procedural and original: geometry is built from lathes / extrusions / displaced spheres, every
// texture is painted on a canvas from seeded noise. render.mjs loads this page in headless Chromium and calls
// window.renderLayers(), which returns one transparent RGBA layer per moving part:
//   base     — tabletop, cutting board, bottle, enamel mug, gherkins (everything that never moves)
//   sausage  — the sausage stick with its own shadow on the board
//   slice-N  — each cut slice with its own shadow, so the hover animation can slide them apart
// Transparency is recovered by difference matting (the same frame rendered over black and over white), which also
// keeps the glass bottle's partial transparency and soft shadows exact.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const OUT_W = 612
const OUT_H = 348
const SS = 2 // supersampling factor
const W = OUT_W * SS
const H = OUT_H * SS

// ---------------------------------------------------------------- seeded noise
let seed = 20260929
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const rr = (a, b) => a + (b - a) * rnd()
const PERM = new Uint8Array(512)
{
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
}
const fade = (t) => t * t * (3 - 2 * t)
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const h = (a, b) => PERM[(PERM[a & 255] + b) & 255] / 255
  const u = fade(xf), v = fade(yf)
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); n += a; a *= 0.5; f *= 2.03 }
  return s / n
}
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const mix = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]
const mixc = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)]

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}
function paint(w, h, fn) {
  // fn(x, y) -> [r, g, b] (0..255) ; returns canvas
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y), i = (y * w + x) * 4
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col[3] ?? 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}
function tex(c, { srgb = true, repeat } = {}) {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (repeat) t.repeat.set(...repeat)
  return t
}

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(W, H)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.86
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.32

// warm key light from the upper left (a kitchen lamp), cool teal rim from the right (the theme's rim light)
const key = new THREE.DirectionalLight(0xffe2bf, 3.4)
key.position.set(-40, 62, 26)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.radius = 4
key.shadow.blurSamples = 20
key.shadow.bias = -0.0004
key.shadow.normalBias = 0.02
Object.assign(key.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35, near: 10, far: 160 })
scene.add(key)
const rim = new THREE.DirectionalLight(0x8fd6da, 0.9)
rim.position.set(50, 22, -30)
scene.add(rim)
const fill = new THREE.DirectionalLight(0xdfe6ff, 0.35)
fill.position.set(10, 30, 60)
scene.add(fill)

// catches shadows on the (transparent) sidebar surface around the tabletop
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), new THREE.ShadowMaterial({ opacity: 0.55 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// blob "contact" shadow texture used under objects (ambient occlusion stand-in)
const blobTex = (() => {
  const c = canvas(256, 256), ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.45, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256)
  return tex(c)
})()
function blob(w, d, opacity = 0.6) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false, toneMapped: false }))
  m.rotation.x = -Math.PI / 2
  m.renderOrder = 1
  return m
}

// ---------------------------------------------------------------- layout (cm)
const TABLE_TOP = 0.35
const BOARD = { x: 5, z: 1, rot: THREE.MathUtils.degToRad(13), thick: 2.2 }
const BOARD_TOP = TABLE_TOP + BOARD.thick
const MUG = { x: -20, z: 7.5 }
const BOTTLE = { x: 6.5, z: -12.5 }

// ---------------------------------------------------------------- tabletop (a piece of an old kitchen table)
// dark varnished planks with worn-through varnish, scratches, a couple of glass rings and a visible front edge
function tabletopTextures() {
  const w = 2048, h = 1400, pxcm = 30, PLANK = 11.5
  const colour = paint(w, h, (x, y) => {
    const cx = x / pxcm, cy = y / pxcm
    const plank = Math.floor(cy / PLANK), py = cy - plank * PLANK
    const shift = plank * 37.3
    const warp = 1.6 * fbm((cx + shift) * 0.04, cy * 0.2, 4)
    const t = (py + warp + plank * 0.7) * 1.6
    const ring = Math.pow(Math.abs(Math.sin(t * Math.PI)), 5)
    const pores = vnoise((cx + shift) * 0.5, cy * 22) * vnoise((cx + shift) * 1.2 + 3, cy * 34)
    const tone = fbm((cx + shift) * 0.02, plank * 3.1, 3)
    let c = mixc(hex(0x5a3a22), hex(0x3b2414), clamp(0.3 + 0.6 * tone))
    c = mixc(c, hex(0x24150b), clamp(ring * 0.5 + (pores > 0.55 ? 0.2 : 0)))
    // varnish worn off towards the middle (where plates and elbows go): paler, greyer wood
    const wear = clamp(fbm(cx * 0.05 + 11, cy * 0.05, 3) * 1.4 - 0.45) * Math.exp(-((cx - 34) ** 2) / 500 - ((cy - 23) ** 2) / 260)
    c = mixc(c, hex(0x8a6a4c), wear * 0.55)
    // gaps between planks
    const gap = Math.min(py, PLANK - py)
    if (gap < 0.18) c = mixc(c, hex(0x0c0704), 0.85)
    else if (gap < 0.45) c = mixc(c, hex(0x160d07), 0.4)
    return c
  })
  const bump = paint(w / 2, h / 2, (x, y) => {
    const cx = x * 2 / pxcm, cy = y * 2 / pxcm
    const plank = Math.floor(cy / PLANK), py = cy - plank * PLANK
    const gap = Math.min(py, PLANK - py)
    const v = 150 - vnoise((cx + plank * 37.3) * 0.5, cy * 22) * 30 - (gap < 0.3 ? 110 : 0)
    return [v, v, v]
  })
  const rough = paint(w / 4, h / 4, (x, y) => {
    const cx = x * 4 / pxcm, cy = y * 4 / pxcm
    const wear = clamp(fbm(cx * 0.05 + 11, cy * 0.05, 3) * 1.4 - 0.45)
    const v = 255 * clamp(0.32 + wear * 0.4 + 0.12 * (fbm(cx * 0.3, cy * 0.3, 3) - 0.5))
    return [v, v, v]
  })
  const cctx = colour.getContext('2d'), bctx = bump.getContext('2d')
  // scratches and dents
  for (let i = 0; i < 260; i++) {
    const cx = rr(2, w / pxcm - 2), cy = rr(2, h / pxcm - 2), len = rr(0.6, 7), ang = rr(-0.5, 0.5) + (rnd() < 0.3 ? Math.PI / 2 : 0)
    const dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2
    cctx.lineCap = 'round'
    cctx.strokeStyle = `rgba(190,150,110,${rr(0.05, 0.22)})`; cctx.lineWidth = rr(0.6, 1.6)
    cctx.beginPath(); cctx.moveTo((cx - dx) * pxcm, (cy - dy) * pxcm); cctx.lineTo((cx + dx) * pxcm, (cy + dy) * pxcm); cctx.stroke()
    bctx.strokeStyle = `rgba(60,60,60,${rr(0.2, 0.6)})`; bctx.lineWidth = 0.8
    bctx.beginPath(); bctx.moveTo((cx - dx) * pxcm / 2, (cy - dy) * pxcm / 2); bctx.lineTo((cx + dx) * pxcm / 2, (cy + dy) * pxcm / 2); bctx.stroke()
  }
  // two pale rings from wet glasses
  for (const [cx, cy, r] of [[14, 30, 3.1], [52, 12, 2.7]]) {
    cctx.strokeStyle = 'rgba(190,165,130,0.09)'; cctx.lineWidth = 0.28 * pxcm
    cctx.beginPath(); cctx.arc(cx * pxcm, cy * pxcm, r * pxcm, 0.3, Math.PI * 1.85); cctx.stroke()
    cctx.strokeStyle = 'rgba(200,175,140,0.05)'; cctx.lineWidth = 0.12 * pxcm
    cctx.beginPath(); cctx.arc(cx * pxcm + 5, cy * pxcm + 3, r * pxcm * 0.97, 0, Math.PI * 2); cctx.stroke()
  }
  const side = paint(512, 64, (x, y) => {
    const v = vnoise(x * 0.05, y * 0.4) * 0.6 + fbm(x * 0.03, y * 0.1, 3) * 0.4
    let c = mixc(hex(0x3a2413), hex(0x1f120a), v)
    if (y < 4) c = mixc(c, hex(0x8a6a4c), 0.35) // the worn top arris
    return c
  })
  const rep = [1 / (w / pxcm), 1 / (h / pxcm)]
  return { map: tex(colour, { repeat: rep }), bump: tex(bump, { srgb: false, repeat: rep }), rough: tex(rough, { srgb: false, repeat: rep }), side: tex(side) }
}
const TABLE = { w: 66, d: 44, thick: 3.2 }
function buildTabletop() {
  const t = tabletopTextures()
  const geo = new THREE.BoxGeometry(TABLE.w, TABLE.thick, TABLE.d, 1, 1, 1)
  // top face UVs in cm so the texture repeat maps 1:1
  const uv = geo.attributes.uv, pos = geo.attributes.position, nor = geo.attributes.normal
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, pos.getX(i) + TABLE.w / 2, pos.getZ(i) + TABLE.d / 2)
  }
  const top = new THREE.MeshPhysicalMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 0.6, roughnessMap: t.rough, roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.45 })
  const edge = new THREE.MeshStandardMaterial({ map: t.side, roughness: 0.7 })
  const mesh = new THREE.Mesh(geo, [edge, edge, top, top, edge, edge])
  mesh.castShadow = true; mesh.receiveShadow = true
  mesh.position.set(-4, TABLE_TOP - TABLE.thick / 2, 2)
  mesh.rotation.y = THREE.MathUtils.degToRad(-6)
  const g = new THREE.Group(); g.add(mesh)
  return g
}

function woodTextures() {
  // top face: 50 x 24 cm at 40 px/cm, grain along x
  const w = 2000, h = 960, pxcm = 40
  const light = hex(0xb99873), mid = hex(0x94704d), dark = hex(0x64442c)
  const colour = paint(w, h, (x, y) => {
    const cx = x / pxcm, cy = y / pxcm
    const warp = 2.2 * fbm(cx * 0.05, cy * 0.12, 4) + 0.6 * fbm(cx * 0.3, cy * 0.9, 2)
    const t = (cy + warp) * 2.1
    const ring = Math.pow(Math.abs(Math.sin(t * Math.PI)), 6)
    const late = Math.pow(Math.abs(Math.sin(t * Math.PI + 0.9)), 18)
    const pores = vnoise(cx * 0.6, cy * 26) * vnoise(cx * 1.4 + 3, cy * 40)
    const tone = 0.5 + 0.5 * (fbm(cx * 0.03, cy * 0.08, 3) - 0.5) * 2
    let c = mixc(light, mid, clamp(0.35 + 0.4 * tone))
    c = mixc(c, dark, clamp(ring * 0.55 + late * 0.35 + (pores > 0.55 ? 0.25 : 0)))
    // the middle, where things are cut, is paler and greyer from washing; the rim keeps its oil
    const wear = Math.exp(-((cx - 22) ** 2) / 180 - ((cy - 12) ** 2) / 40)
    c = mixc(c, hex(0xc9b39a), wear * 0.28)
    return c
  })
  const bump = paint(w / 2, h / 2, (x, y) => {
    const cx = x * 2 / pxcm, cy = y * 2 / pxcm
    const warp = 2.2 * fbm(cx * 0.05, cy * 0.12, 4) + 0.6 * fbm(cx * 0.3, cy * 0.9, 2)
    const ring = Math.pow(Math.abs(Math.sin((cy + warp) * 2.1 * Math.PI)), 6)
    const v = 150 - ring * 30 - vnoise(cx * 0.6, cy * 26) * 40
    return [v, v, v]
  })
  const rough = paint(w / 4, h / 4, (x, y) => {
    const cx = x * 4 / pxcm, cy = y * 4 / pxcm
    const wear = Math.exp(-((cx - 22) ** 2) / 180 - ((cy - 12) ** 2) / 40)
    const v = 255 * clamp(0.55 + wear * 0.25 + 0.15 * (fbm(cx * 0.4, cy * 0.4, 3) - 0.5))
    return [v, v, v]
  })
  // knife marks: short straight cuts, lighter cut fibres with a thin dark groove; bump gets the groove
  const cctx = colour.getContext('2d'), bctx = bump.getContext('2d')
  for (let i = 0; i < 380; i++) {
    const cx = 22 + (rnd() + rnd() + rnd() - 1.5) * 26, cy = 12 + (rnd() + rnd() - 1) * 11
    const len = rr(0.8, 4.5), ang = (rnd() < 0.7 ? rr(-0.6, 0.6) + Math.PI / 2 : rr(-0.5, 0.5))
    const dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2
    const x0 = (cx - dx) * pxcm, y0 = (cy - dy) * pxcm, x1 = (cx + dx) * pxcm, y1 = (cy + dy) * pxcm
    cctx.lineCap = 'round'
    cctx.strokeStyle = `rgba(226,200,165,${rr(0.06, 0.2)})`; cctx.lineWidth = rr(1, 2)
    cctx.beginPath(); cctx.moveTo(x0, y0); cctx.lineTo(x1, y1); cctx.stroke()
    cctx.strokeStyle = `rgba(70,40,20,${rr(0.1, 0.3)})`; cctx.lineWidth = 0.8
    cctx.beginPath(); cctx.moveTo(x0 + 1, y0 + 1); cctx.lineTo(x1 + 1, y1 + 1); cctx.stroke()
    bctx.strokeStyle = `rgba(40,40,40,${rr(0.3, 0.7)})`; bctx.lineWidth = 0.9
    bctx.beginPath(); bctx.moveTo(x0 / 2, y0 / 2); bctx.lineTo(x1 / 2, y1 / 2); bctx.stroke()
  }
  // a faint old stain (beetroot or tea) near the handle end
  const g = cctx.createRadialGradient(40 * pxcm, 16 * pxcm, 0, 40 * pxcm, 16 * pxcm, 3.2 * pxcm)
  g.addColorStop(0, 'rgba(90,40,30,0.12)'); g.addColorStop(1, 'rgba(90,40,30,0)')
  cctx.fillStyle = g; cctx.fillRect(0, 0, w, h)

  // edges: darker, oiled; end grain shows short vertical streaks
  const side = paint(512, 128, (x, y) => {
    const v = vnoise(x * 0.4, y * 0.02) * 0.6 + fbm(x * 0.05, y * 0.05, 3) * 0.4
    const streak = Math.pow(vnoise(x * 1.3, y * 0.05), 3)
    return mixc(mixc(hex(0x8e5b33), hex(0x5e3a1f), v), hex(0x3f2715), streak * 0.5)
  })
  return { map: tex(colour, { repeat: [1 / 50, 1 / 24] }), bump: tex(bump, { srgb: false, repeat: [1 / 50, 1 / 24] }), rough: tex(rough, { srgb: false, repeat: [1 / 50, 1 / 24] }), side: tex(side, { repeat: [1 / 12, 1 / 2.6] }) }
}

function buildBoard() {
  const s = new THREE.Shape()
  const r = 2.2
  // main plank -20..20 x -11..11, handle 20..29 x -3.6..3.6 with a rounded end
  s.moveTo(-20 + r, -11)
  s.lineTo(20 - r, -11); s.quadraticCurveTo(20, -11, 20, -11 + r)
  s.lineTo(20, -5.2); s.quadraticCurveTo(20.2, -3.6, 22, -3.6)
  s.lineTo(26.5, -3.6); s.absarc(26.5, 0, 3.6, -Math.PI / 2, Math.PI / 2, false)
  s.lineTo(22, 3.6); s.quadraticCurveTo(20.2, 3.6, 20, 5.2)
  s.lineTo(20, 11 - r); s.quadraticCurveTo(20, 11, 20 - r, 11)
  s.lineTo(-20 + r, 11); s.quadraticCurveTo(-20, 11, -20, 11 - r)
  s.lineTo(-20, -11 + r); s.quadraticCurveTo(-20, -11, -20 + r, -11)
  const hole = new THREE.Path(); hole.absarc(26.8, 0, 1.15, 0, Math.PI * 2, true); s.holes.push(hole)
  const bevel = 0.35
  const geo = new THREE.ExtrudeGeometry(s, { depth: BOARD.thick - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 48 })
  // top & bottom faces carry shape coordinates (cm) as UVs, sides (length, height): the textures' repeat/offset map them
  geo.translate(0, 0, bevel)
  geo.rotateX(-Math.PI / 2)
  const t = woodTextures()
  t.map.offset.set(20 / 50, 11 / 24); t.bump.offset.copy(t.map.offset); t.rough.offset.copy(t.map.offset)
  const top = new THREE.MeshPhysicalMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 0.9, roughnessMap: t.rough, roughness: 1, clearcoat: 0.08, clearcoatRoughness: 0.6 })
  const edge = new THREE.MeshPhysicalMaterial({ map: t.side, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.5 })
  const mesh = new THREE.Mesh(geo, [top, edge])
  mesh.castShadow = true; mesh.receiveShadow = true
  mesh.position.set(BOARD.x, TABLE_TOP, BOARD.z)
  mesh.rotation.y = BOARD.rot
  mesh.userData.materials = [top, edge]
  return mesh
}
// board-local (x along the plank, z towards the viewer) to world, on the board's top surface
function onBoard(lx, lz, lift = 0) {
  const v = new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), BOARD.rot)
  return new THREE.Vector3(BOARD.x + v.x, BOARD_TOP + lift, BOARD.z + v.z)
}

// ---------------------------------------------------------------- sausage (salami)
function casingTextures() {
  // u around (13 cm), v along (26 cm)
  const w = 512, h = 1024
  const base = hex(0x4e1810), light = hex(0x7a3222), dark = hex(0x2a0c08)
  const colour = paint(w, h, (x, y) => {
    const u = x / w, v = y / h
    const m = fbm(u * 8, v * 16, 4)
    const wr = vnoise(u * 60, v * 5) // longitudinal wrinkles
    let c = mixc(base, light, clamp((m - 0.45) * 2.2))
    c = mixc(c, dark, clamp((0.5 - wr) * 0.9))
    // fat bits showing through the casing
    const fat = vnoise(u * 90 + 5, v * 150 + 3)
    if (fat > 0.76) c = mixc(c, hex(0xc48f80), (fat - 0.76) * 3)
    // faint white bloom
    const bloom = fbm(u * 20 + 11, v * 30, 3)
    c = mixc(c, hex(0xd9c9bb), clamp((bloom - 0.66) * 1.4) * 0.3)
    return c
  })
  const bump = paint(w / 2, h / 2, (x, y) => {
    const u = x * 2 / w, v = y * 2 / h
    const val = 128 + 70 * (vnoise(u * 60, v * 5) - 0.5) + 30 * (vnoise(u * 20, v * 40) - 0.5) + 25 * (vnoise(u * 90 + 5, v * 150 + 3) - 0.5)
    return [val, val, val]
  })
  return { map: tex(colour), bump: tex(bump, { srgb: false }) }
}
function marbleTexture() {
  // a cut face: dark-red meat with white fat specks, a thin casing ring and a few peppercorns
  const n = 512, c = canvas(n, n), ctx = c.getContext('2d')
  const img = paint(n, n, (x, y) => {
    const u = x / n, v = y / n
    const m = fbm(u * 14, v * 14, 4), m2 = vnoise(u * 60, v * 60)
    return mixc(mixc(hex(0x6e1a18), hex(0xa33a31), clamp((m - 0.35) * 1.8)), hex(0x4a100e), clamp((0.35 - m2) * 1.5))
  })
  ctx.drawImage(img, 0, 0)
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.43 * n
    const x = n / 2 + Math.cos(a) * d, y = n / 2 + Math.sin(a) * d
    const r = rr(1.2, 5) * (rnd() < 0.1 ? 2.2 : 1)
    ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI)
    ctx.fillStyle = `rgba(${rr(226, 244)},${rr(196, 218)},${rr(182, 204)},${rr(0.75, 1)})`
    ctx.beginPath()
    for (let k = 0; k <= 10; k++) { const t = k / 10 * Math.PI * 2, rad = r * (0.7 + 0.5 * rnd()); ctx.lineTo(Math.cos(t) * rad * 1.3, Math.sin(t) * rad * 0.8) }
    ctx.fill(); ctx.restore()
  }
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.4 * n
    ctx.fillStyle = '#1d1411'; ctx.beginPath(); ctx.arc(n / 2 + Math.cos(a) * d, n / 2 + Math.sin(a) * d, rr(2.5, 4), 0, Math.PI * 2); ctx.fill()
  }
  ctx.strokeStyle = '#3c130c'; ctx.lineWidth = n * 0.035
  ctx.beginPath(); ctx.arc(n / 2, n / 2, n / 2 - n * 0.018, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = 'rgba(180,70,55,0.6)'; ctx.lineWidth = n * 0.012
  ctx.beginPath(); ctx.arc(n / 2, n / 2, n / 2 - n * 0.045, 0, Math.PI * 2); ctx.stroke()
  const bump = paint(n / 2, n / 2, (x, y) => { const v = 128 + 60 * (vnoise(x * 0.3, y * 0.3) - 0.5); return [v, v, v] })
  return { map: tex(c), bump: tex(bump, { srgb: false }) }
}

const SAUSAGE_R = 2.15
const SAUSAGE_L = 22
function buildSausage(casing, cut) {
  const pts = []
  const N = 140
  for (let j = 0; j <= N; j++) {
    const y = (j / N) * SAUSAGE_L
    let r
    if (y < 2.6) { const t = y / 2.6; r = SAUSAGE_R * (0.16 + 0.84 * Math.pow(Math.sin(t * Math.PI / 2), 0.55)) } else r = SAUSAGE_R * (1 - 0.025 * Math.sin(y * 0.7))
    pts.push(new THREE.Vector2(r, y))
  }
  const geo = new THREE.LatheGeometry(pts, 120)
  // casing wrinkles in the geometry, then a gentle bend
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const a = Math.atan2(x, z)
    const k = 1 + 0.028 * (vnoise(a * 9, y * 0.35) - 0.5) * 2 + 0.018 * (vnoise(a * 30, y * 2) - 0.5)
    pos.setX(i, x * k + 0.004 * (y - SAUSAGE_L / 2) ** 2); pos.setZ(i, z * k)
  }
  geo.computeVertexNormals()
  const group = new THREE.Group()
  const skin = new THREE.MeshPhysicalMaterial({ map: casing.map, bumpMap: casing.bump, bumpScale: 2.2, roughness: 0.46, clearcoat: 0.4, clearcoatRoughness: 0.35, sheen: 0.3, sheenColor: new THREE.Color(0xffd0c0) })
  const body = new THREE.Mesh(geo, skin)
  body.castShadow = true; body.receiveShadow = true
  group.add(body)
  // cut face, slightly concave rim is irrelevant at this size: a disc
  const face = new THREE.Mesh(new THREE.CircleGeometry(SAUSAGE_R * 0.995, 64), new THREE.MeshPhysicalMaterial({ map: cut.map, bumpMap: cut.bump, bumpScale: 1, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.35 }))
  face.rotation.x = -Math.PI / 2
  face.position.set(0.004 * (SAUSAGE_L / 2) ** 2, SAUSAGE_L, 0)
  face.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -Math.atan(0.008 * SAUSAGE_L / 2))
  face.castShadow = true
  group.add(face)
  // twine at the tied end
  const twineMat = new THREE.MeshStandardMaterial({ color: 0xcbb991, roughness: 0.95 })
  const knot = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.13, 10, 24), twineMat)
  knot.rotation.x = Math.PI / 2; knot.position.set(0.004 * (SAUSAGE_L / 2) ** 2, 0.35, 0)
  group.add(knot)
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.3, 0.3, 0), new THREE.Vector3(0.9, -0.9, 0.5), new THREE.Vector3(1.8, -1.6, 0.4), new THREE.Vector3(2.6, -1.9, 1.2)]), 24, 0.09, 8), twineMat)
  tail.position.x = 0.004 * (SAUSAGE_L / 2) ** 2
  group.add(tail)
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  return group
}
function buildSlice(casing, cut, i) {
  const th = rr(0.32, 0.42)
  const geo = new THREE.CylinderGeometry(SAUSAGE_R * rr(0.96, 1.02), SAUSAGE_R, th, 72, 1)
  const faceMat = new THREE.MeshPhysicalMaterial({ map: cut.map.clone(), bumpMap: cut.bump, bumpScale: 1, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35 })
  faceMat.map.rotation = i * 1.7; faceMat.map.center.set(0.5, 0.5); faceMat.map.needsUpdate = true
  const skin = new THREE.MeshPhysicalMaterial({ map: casing.map, roughness: 0.5, clearcoat: 0.3 })
  const m = new THREE.Mesh(geo, [skin, faceMat, faceMat])
  m.castShadow = true; m.receiveShadow = true
  m.userData.th = th
  return m
}

// ---------------------------------------------------------------- gherkins
function gherkinTextures() {
  const w = 512, h = 512
  const colour = paint(w, h, (x, y) => {
    const u = x / w, v = y / h
    const streak = vnoise(u * 24, v * 2.5)
    const m = fbm(u * 10, v * 6, 3)
    let c = mixc(hex(0x2a3010), hex(0x5d6a26), clamp(streak * 0.9 + (m - 0.5) * 0.6))
    const tip = Math.min(v, 1 - v)
    c = mixc(c, hex(0x6b6a2a), smooth(0.1, 0.0, tip) * 0.6)
    const speck = vnoise(u * 160, v * 80)
    if (speck > 0.8) c = mixc(c, hex(0xa8b064), (speck - 0.8) * 2.5)
    return c
  })
  return { map: tex(colour) }
}
function buildGherkin(t, len = 7.6, rad = 1.35, bend = 0.5) {
  const geo = new THREE.SphereGeometry(1, 96, 64)
  const pos = geo.attributes.position
  const warts = Array.from({ length: 150 }, () => ({ a: rnd() * Math.PI * 2, y: rr(-0.9, 0.9), s: rr(0.5, 1.1) }))
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const a = Math.atan2(z, x)
    let r = rad * Math.pow(Math.max(0, 1 - y * y), 0.42) * (1 + 0.06 * y)
    // shallow lengthwise ridges and the warts
    r *= 1 + 0.025 * Math.cos(a * 7)
    let bump = 0
    for (const wt of warts) {
      let da = Math.abs(a - wt.a); da = Math.min(da, Math.PI * 2 - da)
      const d2 = (da * rad) ** 2 + ((y - wt.y) * len / 2) ** 2
      bump += 0.1 * wt.s * Math.exp(-d2 / (0.035 * wt.s))
    }
    r += bump * Math.sqrt(Math.max(0, 1 - y * y))
    const nx = Math.hypot(x, z) > 1e-6 ? x / Math.hypot(x, z) : 0, nz = Math.hypot(x, z) > 1e-6 ? z / Math.hypot(x, z) : 0
    pos.setXYZ(i, nx * r + bend * y * y, y * len / 2, nz * r)
    const k = clamp(1 + bump * 4, 1, 1.5)
    colors[i * 3] = k; colors[i * 3 + 1] = k; colors[i * 3 + 2] = Math.min(k, 1.5)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  geo.rotateZ(Math.PI / 2) // long axis along x
  const mat = new THREE.MeshPhysicalMaterial({ map: t.map, vertexColors: true, roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.28 })
  const m = new THREE.Mesh(geo, mat)
  // blossom-end scar and stalk
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x5b5a2a, roughness: 0.8 }))
  stalk.rotation.z = Math.PI / 2; stalk.position.set(len / 2 + 0.15, bend * 1, 0)
  const g = new THREE.Group(); g.add(m); g.add(stalk)
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  return g
}

// ---------------------------------------------------------------- enamel mug (empty)
function enamelTextures() {
  const w = 1024, h = 512 // u around, v bottom -> top of the outer wall
  const white = hex(0xeceae4), navy = hex(0x1e2d5c)
  const c = paint(w, h, (x, y) => {
    const v = 1 - y / h
    const speck = vnoise(x * 0.9, y * 0.9)
    const cloud = fbm(x * 0.01, y * 0.02, 3)
    let col = mixc(white, hex(0xcfd3d6), clamp((cloud - 0.45) * 1.2))
    if (speck > 0.86) col = mixc(col, hex(0x6d7486), 0.35)
    if (v < 0.05 || v > 0.965) col = mixc(navy, hex(0x2a3d78), cloud)
    // grime line at the base
    if (v >= 0.05 && v < 0.09) col = mixc(col, hex(0x9a978c), (0.09 - v) * 12)
    return col
  })
  const b = paint(w / 2, h / 2, () => [200, 200, 200])
  const ctx = c.getContext('2d'), bctx = b.getContext('2d')
  // chipped enamel: iron core, blue-black ground coat around it, a bright broken edge
  const chips = [[0.03, 0.78, 26], [0.93, 0.3, 18], [0.12, 0.2, 12], [0.86, 0.92, 22], [0.2, 0.62, 9], [0.08, 0.95, 16], [0.55, 0.4, 20], [0.7, 0.8, 14]]
  for (const [u, v, s] of chips) {
    const cx = u * w, cy = (1 - v) * h
    const pts = Array.from({ length: 14 }, (_, k) => { const a = k / 14 * Math.PI * 2, r = s * rr(0.55, 1.15); return [cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 0.9] })
    const poly = (context, scale, fill, dx = 0, dy = 0, div = 1) => {
      context.fillStyle = fill; context.beginPath()
      pts.forEach(([px, py], k) => { const X = (cx + (px - cx) * scale + dx) / div, Y = (cy + (py - cy) * scale + dy) / div; if (k) context.lineTo(X, Y); else context.moveTo(X, Y) })
      context.closePath(); context.fill()
    }
    poly(ctx, 1.12, 'rgba(255,255,255,0.9)', -1, -1)
    poly(ctx, 1.0, '#1b2230')
    poly(ctx, 0.62, '#2b2420')
    poly(ctx, 0.35, '#5a3a24', 1, 1)
    poly(bctx, 1.0, 'rgb(90,90,90)', 0, 0, 2)
  }
  const inner = paint(512, 256, (x, y) => {
    const cloud = fbm(x * 0.02, y * 0.03, 3)
    const v = 1 - y / 256
    let col = mixc(hex(0xe9e8e2), hex(0xc9cbc8), clamp((cloud - 0.4) * 1.4) * 0.8)
    if (v > 0.955) col = mixc(navy, hex(0x2a3d78), cloud)
    col = mixc(col, hex(0xb8b3a6), smooth(0.25, 0.0, v) * 0.35) // old tea shadow at the bottom (dry)
    return col
  })
  return { map: tex(c), bump: tex(b, { srgb: false }), inner: tex(inner) }
}
function buildMug() {
  const t = enamelTextures()
  const R = 3.9, Hh = 8.4
  const outerPts = []
  for (let j = 0; j <= 60; j++) {
    const y = j / 60 * Hh
    const r = y < 0.45 ? R - 0.35 + 0.35 * Math.sin(y / 0.45 * Math.PI / 2) : R
    outerPts.push(new THREE.Vector2(r, y))
  }
  const enamel = (map, extra = {}) => new THREE.MeshPhysicalMaterial({ map, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, ...extra })
  const outer = new THREE.Mesh(new THREE.LatheGeometry(outerPts, 96), enamel(t.map, { bumpMap: t.bump, bumpScale: 1.5 }))
  const innerPts = []
  for (let j = 0; j <= 40; j++) {
    const y = Hh - j / 40 * (Hh - 0.7)
    innerPts.push(new THREE.Vector2(R - 0.14, y))
  }
  innerPts.push(new THREE.Vector2(R - 0.4, 0.42), new THREE.Vector2(R - 0.9, 0.34), new THREE.Vector2(0.001, 0.32))
  const inner = new THREE.Mesh(new THREE.LatheGeometry(innerPts, 96), enamel(t.inner, { side: THREE.DoubleSide }))
  const rimMat = new THREE.MeshPhysicalMaterial({ color: 0x1c2a58, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 })
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(R - 0.07, 0.12, 16, 96), rimMat)
  rimRing.rotation.x = Math.PI / 2; rimRing.position.y = Hh
  // a chip in the rim: exposed iron
  const chip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.7, metalness: 0.5 }))
  chip.position.set(Math.sin(0.35) * (R - 0.05), Hh + 0.05, Math.cos(0.35) * (R - 0.05)); chip.scale.set(1.4, 0.7, 1)
  // handle: a flattened strip bent into a D, white enamel with dark worn edges
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-R + 0.2, 7.3, 0), new THREE.Vector3(-R - 1.4, 7.25, 0), new THREE.Vector3(-R - 2.35, 6.4, 0),
    new THREE.Vector3(-R - 2.45, 4.6, 0), new THREE.Vector3(-R - 1.8, 3.2, 0), new THREE.Vector3(-R + 0.2, 2.6, 0),
  ])
  const hGeo = new THREE.TubeGeometry(curve, 80, 0.36, 16, false)
  // flatten the tube cross-section into a strip (wide along z)
  const hp = hGeo.attributes.position
  const tmp = new THREE.Vector3()
  for (let i = 0; i < hp.count; i++) {
    tmp.fromBufferAttribute(hp, i)
    const tt = Math.floor(i / 17) / 80, c = curve.getPointAt(Math.min(1, tt))
    const d = tmp.clone().sub(c)
    d.z *= 1.9; d.x *= 0.55; d.y *= 0.55
    hp.setXYZ(i, c.x + d.x, c.y + d.y, c.z + d.z)
  }
  hGeo.computeVertexNormals()
  const hTex = paint(256, 64, (x, y) => {
    const v = y / 64, edge = Math.min(Math.abs(v - 0.25), Math.abs(v - 0.75))
    const worn = vnoise(x * 0.15, y * 0.4)
    return edge < 0.06 && worn > 0.35 ? hex(0x1d1a19) : mixc(hex(0xecebe5), hex(0xc6c9cc), fbm(x * 0.05, y * 0.05, 2) * 0.5)
  })
  const handle = new THREE.Mesh(hGeo, enamel(tex(hTex)))
  const g = new THREE.Group()
  g.add(outer, inner, rimRing, chip, handle)
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  g.position.set(MUG.x, TABLE_TOP, MUG.z)
  g.rotation.y = THREE.MathUtils.degToRad(30)
  const b = blob(10, 10, 0.55); b.position.set(MUG.x, TABLE_TOP + 0.05, MUG.z)
  return [g, b]
}

// ---------------------------------------------------------------- bottle (plain, no brand)
function buildBottle() {
  const prof = new THREE.SplineCurve([
    new THREE.Vector2(0.001, 0.45), new THREE.Vector2(2.4, 0.2), new THREE.Vector2(3.35, 0.02), new THREE.Vector2(3.6, 0.5), new THREE.Vector2(3.62, 2),
    new THREE.Vector2(3.62, 14.5), new THREE.Vector2(3.52, 16.4), new THREE.Vector2(3.05, 18.2), new THREE.Vector2(2.2, 19.8), new THREE.Vector2(1.55, 21.2),
    new THREE.Vector2(1.3, 22.6), new THREE.Vector2(1.22, 24.4), new THREE.Vector2(1.2, 25.3), new THREE.Vector2(1.38, 25.5), new THREE.Vector2(1.4, 25.9),
  ])
  const pts = prof.getPoints(160)
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xf4fbf8, roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.9, ior: 1.52,
    attenuationColor: new THREE.Color(0xb7dccf), attenuationDistance: 9, specularIntensity: 1, envMapIntensity: 1.6, side: THREE.DoubleSide,
  })
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), glass)
  // blank paper label with two thin navy rules — no text, no mark
  const lab = paint(512, 256, (x, y) => {
    const v = y / 256
    let c = mixc(hex(0xe9e2cf), hex(0xd6cdb6), fbm(x * 0.03, y * 0.03, 3) * 0.7)
    if ((v > 0.07 && v < 0.1) || (v > 0.9 && v < 0.93)) c = hex(0x24356a)
    return c
  })
  const label = new THREE.Mesh(new THREE.CylinderGeometry(3.66, 3.66, 5.2, 96, 1, true), new THREE.MeshPhysicalMaterial({ map: tex(lab), roughness: 0.75, side: THREE.DoubleSide }))
  label.position.y = 8.2
  // aluminium screw cap with knurling and a tamper ring
  const knurl = paint(512, 64, (x) => { const v = 128 + 110 * Math.sin(x / 512 * Math.PI * 2 * 60); return [v, v, v] })
  const capMat = new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.32, bumpMap: tex(knurl, { srgb: false }), bumpScale: 1.2, clearcoat: 0.3 })
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.5, 2.3, 64, 1), capMat)
  cap.position.y = 26.95
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(1.48, 48, 8, 0, Math.PI * 2, 0, 0.35), new THREE.MeshPhysicalMaterial({ color: 0xd4d7da, metalness: 1, roughness: 0.25 }))
  capTop.position.y = 28.1 - 1.48 * Math.cos(0.35); capTop.scale.y = 1
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.55, 64, 1), new THREE.MeshPhysicalMaterial({ color: 0xb6babf, metalness: 1, roughness: 0.4 }))
  ring.position.y = 25.55
  const g = new THREE.Group()
  g.add(body, label, cap, capTop, ring)
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  g.position.set(BOTTLE.x, TABLE_TOP, BOTTLE.z)
  g.scale.setScalar(0.74) // a 0.25 l bottle
  g.rotation.y = 0.4
  const b = blob(7, 7, 0.5); b.position.set(BOTTLE.x, TABLE_TOP + 0.05, BOTTLE.z)
  return [g, b]
}

// ---------------------------------------------------------------- assemble
const tabletop = buildTabletop()
ground.position.y = TABLE_TOP - TABLE.thick - 0.05
const board = buildBoard()
const boardBlob = blob(56, 30, 0.35); boardBlob.position.set(BOARD.x + 4, TABLE_TOP + 0.04, BOARD.z); boardBlob.rotation.z = BOARD.rot
const [mug, mugBlob] = buildMug()
const [bottle, bottleBlob] = buildBottle()

const gt = gherkinTextures()
const gherkins = []
{
  const a = buildGherkin(gt, 7.8, 1.4, 0.45); a.position.copy(onBoard(-8, -6.8, 1.35)); a.rotation.y = 0.35; gherkins.push(a)
  const b = buildGherkin(gt, 7.0, 1.3, -0.4); b.position.copy(onBoard(1.5, -7.4, 1.25)); b.rotation.y = -0.25; b.rotation.x = 0.4; gherkins.push(b)
  const c = buildGherkin(gt, 7.4, 1.38, 0.5); c.position.set(-18.5, TABLE_TOP + 1.3, 17); c.rotation.y = 0.3; gherkins.push(c)
}
const gherkinBlobs = gherkins.map((g) => { const b = blob(8.5, 3.6, 0.55); b.position.set(g.position.x, g.position.y - 1.25, g.position.z); b.rotation.z = g.rotation.y; return b })

const casing = casingTextures()
const cut = marbleTexture()
const sausage = new THREE.Group()
{
  const s = buildSausage(casing, cut)
  s.rotation.z = -Math.PI / 2 // lathe axis y -> +x (tied end left, cut end right)
  const holder = new THREE.Group()
  holder.add(s)
  holder.position.copy(onBoard(-15, -3, SAUSAGE_R * 0.97))
  holder.rotation.y = BOARD.rot + THREE.MathUtils.degToRad(-16)
  sausage.add(holder)
  const sb = blob(SAUSAGE_L + 3, 5.5, 0.6)
  const rel = THREE.MathUtils.degToRad(16)
  sb.position.copy(onBoard(-15 + Math.cos(rel) * SAUSAGE_L / 2, -3 + Math.sin(rel) * SAUSAGE_L / 2 + 1, 0.03)); sb.rotation.z = holder.rotation.y
  sausage.add(sb)
  sausage.userData.holder = holder
}
// slices lie fanned in front of the cut end, slightly overlapping like they were just cut off
const SLICE_SPOTS = [
  [10.8, 3.2, 0.15, 0.06], [14.2, 6.4, -0.1, -0.05], [10.4, 8.0, 0.05, 0.08], [16.2, 1.8, -0.12, 0.04], [6.4, 9.2, 0.1, -0.08],
]
const slices = SLICE_SPOTS.map(([lx, lz, tx, tz], i) => {
  const g = new THREE.Group()
  const m = buildSlice(casing, cut, i)
  m.rotation.set(tx, rnd() * Math.PI, tz)
  m.position.y = m.userData.th / 2 + Math.abs(tx) * 1.2
  g.add(m)
  const b = blob(5.4, 5.4, 0.55); b.position.y = 0.03; g.add(b)
  g.position.copy(onBoard(lx, lz, 0))
  g.userData.center = onBoard(lx, lz, 0.2)
  return g
})

const base = [tabletop, board, boardBlob, mug, mugBlob, bottle, bottleBlob, ...gherkins, ...gherkinBlobs, ground]
scene.add(...base, sausage, ...slices)

// ---------------------------------------------------------------- camera
const camera = new THREE.PerspectiveCamera(20, W / H, 20, 400)
const params = new URLSearchParams(location.search)
const camPos = (params.get('cam') || '8,84,90').split(',').map(Number)
const camTgt = (params.get('tgt') || '-1.2,5.6,2.2').split(',').map(Number)
camera.fov = 26
camera.position.set(...camPos)
camera.lookAt(...camTgt)
camera.updateProjectionMatrix()
camera.updateMatrixWorld()
scene.updateMatrixWorld(true)
// auto-frame: project every vertex, then crop the view (setViewOffset) to the content box + a margin, at the output aspect
{
  const v = new THREE.Vector3()
  let x0 = 1, x1 = -1, y0 = 1, y1 = -1
  for (const o of [...base, sausage, ...slices]) {
    if (o === ground) continue
    o.traverse((m) => {
      if (!m.isMesh || m.material.map === blobTex) return
      const p = m.geometry.attributes.position
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).project(camera)
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y)
      }
    })
  }
  const margin = Number(params.get('margin') || 0.02)
  let cw = (x1 - x0) / 2 * W, ch = (y1 - y0) / 2 * H
  const cx = (x0 + x1) / 4 * W + W / 2, cy = H / 2 - (y0 + y1) / 4 * H
  cw *= 1 + margin * 2; ch *= 1 + margin * 2
  if (cw / ch > W / H) ch = cw * H / W; else cw = ch * W / H
  camera.setViewOffset(W, H, cx - cw / 2, cy - ch / 2, cw, ch)
  camera.updateProjectionMatrix()
}

// ---------------------------------------------------------------- layer rendering with difference matting
const shadowCatcher = new THREE.ShadowMaterial({ opacity: 0.5 })
function setMode(layer) {
  const isBase = layer === 'base'
  for (const o of base) o.visible = isBase
  sausage.visible = layer === 'sausage'
  slices.forEach((s, i) => { s.visible = layer === `slice-${i + 1}` })
  // moving layers: the board stays as an invisible shadow catcher, so each part carries its own shadow
  if (!isBase) { board.visible = true; board.material = [shadowCatcher, shadowCatcher]; board.castShadow = false }
  else { board.material = board.userData.materials; board.castShadow = true }
}
const readCanvas = canvas(W, H)
const readCtx = readCanvas.getContext('2d', { willReadFrequently: true })
function grab(bg) {
  scene.background = new THREE.Color(bg)
  renderer.render(scene, camera)
  readCtx.clearRect(0, 0, W, H)
  readCtx.drawImage(renderer.domElement, 0, 0)
  return readCtx.getImageData(0, 0, W, H).data
}
function renderLayer(layer) {
  setMode(layer)
  const B = grab(0x000000), Wt = grab(0xffffff)
  // premultiplied colour = black render; alpha = 1 - (white - black); then 2x2 box downsample
  const out = new Uint8ClampedArray(OUT_W * OUT_H * 4)
  let minX = OUT_W, minY = OUT_H, maxX = -1, maxY = -1
  for (let y = 0; y < OUT_H; y++) for (let x = 0; x < OUT_W; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = ((y * SS + dy) * W + (x * SS + dx)) * 4
      const al = clamp(1 - ((Wt[i] - B[i]) + (Wt[i + 1] - B[i + 1]) + (Wt[i + 2] - B[i + 2])) / (3 * 255))
      r += B[i]; g += B[i + 1]; b += B[i + 2]; a += al
    }
    const n = SS * SS
    a /= n
    const o = (y * OUT_W + x) * 4
    if (a > 0.004) {
      out[o] = r / n / a; out[o + 1] = g / n / a; out[o + 2] = b / n / a; out[o + 3] = Math.round(a * 255)
      if (out[o + 3] > 2) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
    }
  }
  // trim to the bounding box (+1px)
  minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1); maxX = Math.min(OUT_W - 1, maxX + 1); maxY = Math.min(OUT_H - 1, maxY + 1)
  const tw = maxX - minX + 1, th = maxY - minY + 1
  const trimmed = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) trimmed.set(out.subarray(((y + minY) * OUT_W + minX) * 4, ((y + minY) * OUT_W + maxX + 1) * 4), y * tw * 4)
  let bin = ''
  for (let i = 0; i < trimmed.length; i += 32768) bin += String.fromCharCode.apply(null, trimmed.subarray(i, i + 32768))
  return { name: layer, x: minX, y: minY, w: tw, h: th, rgba: btoa(bin) }
}
function project(v) {
  const p = v.clone().project(camera)
  return [(p.x * 0.5 + 0.5) * OUT_W, (1 - (p.y * 0.5 + 0.5)) * OUT_H]
}

window.renderLayers = () => {
  const layers = ['base', 'sausage', ...slices.map((_, i) => `slice-${i + 1}`)].map(renderLayer)
  const holder = sausage.userData.holder
  const tied = new THREE.Vector3(0, 0, 0).applyMatrix4(holder.matrixWorld)
  const cutEnd = new THREE.Vector3(SAUSAGE_L, 0, 0).applyMatrix4(holder.matrixWorld)
  return {
    width: OUT_W, height: OUT_H, layers,
    sausageAxis: [project(tied), project(cutEnd)],
    sliceCenters: slices.map((s) => project(s.userData.center)),
  }
}
// preview: the whole composition on the sidebar colour
window.renderPreview = () => {
  for (const o of base) o.visible = true
  board.material = board.userData.materials; board.castShadow = true
  sausage.visible = true; slices.forEach((s) => { s.visible = true })
  scene.background = new THREE.Color(0x1d1f22)
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}
scene.updateMatrixWorld(true)
document.title = 'ready'
