// Lab page for the boss models' loose parts, driven by physics-lab.mjs.
// ?mode=classes: colours every vertex by the sway analysis class (grey body, blue cloth, orange cord/hair/antenna,
//   green pouch, red held rigid, magenta whole piece) and renders four views (front, right, back, left) side by side.
// ?mode=sim (&motion=turn|walk): runs the secondary physics (src/gallery/physics) through a scripted motion and renders
//   six moments: top row with physics, bottom row the same pose rigid. turn: rest, turning left, just after an abrupt
//   stop, turning right, just after the stop, settled; walk: rest, walking, walking, just after the stop, settling, settled.
// ?mode=strain: plays turns (3 rad/s both ways, then an 8 rad/s flick) and a walk, and colours the model in four views
//   by what the motion did to every vertex: top row how far it moved (blue, full at 10 cm: the body must stay grey),
//   bottom row how much the surface around it stretched or squashed beyond its sculpted size, in millimetres (yellow from
//   2 mm, red from 6 mm: a torn seam you can see).
import { BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Scene, WebGLRenderer, Box3, Vector3, AmbientLight, DirectionalLight, type Material } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { computeSwayWeights } from '../../src/gallery/swayWeights'
import { BOSS_SWAY_HINTS as BOSS_HINTS } from '../../src/gallery/bossSwayHints'
import { TRADER_SWAY_HINTS } from '../../src/gallery/traderSwayHints'
import { buildPhysicsRig } from '../../src/gallery/physics/rig'
import { BossPhysics } from '../../src/gallery/physics/sim'
import { PhysicsMesh } from '../../src/gallery/physics/skin'

const q = new URLSearchParams(location.search)
const key = q.get('key') ?? ''
/** Bosses and traders (their keys never collide). */
const BOSS_SWAY_HINTS = { ...TRADER_SWAY_HINTS, ...BOSS_HINTS }
const mode = q.get('mode') ?? 'classes'
const S = +(q.get('s') || 420)
const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setSize(mode === 'sim' ? S * 6 : S * 4, mode === 'sim' || mode === 'strain' ? S * 2 : S, false)
renderer.setClearColor(0x202322, 1)
const scene = new Scene()
scene.add(new AmbientLight(0xffffff, 1.4))
const sun = new DirectionalLight(0xffffff, 1.6); sun.position.set(1, 2, 3); scene.add(sun)
const back = new DirectionalLight(0xffffff, 0.9); back.position.set(-1, 1.5, -3); scene.add(back)

new GLTFLoader().load(q.get('m') ?? '', (gltf) => {
  let mesh: Mesh | null = null
  gltf.scene.traverse((o) => { if ((o as Mesh).isMesh) mesh = o as Mesh })
  if (!mesh) { document.title = 'err no mesh'; return }
  if (mode === 'sim') simulate(gltf.scene, mesh)
  else if (mode === 'strain') strain(gltf.scene, mesh)
  else classes(gltf.scene, mesh)
}, undefined, (error) => { document.title = 'err ' + String(error) })

function classes(root: Group, m: Mesh) {
  const geometry = m.geometry
  const position = geometry.getAttribute('position').array as Float32Array
  const index = (geometry.index?.array ?? null) as Uint32Array | null
  const t0 = performance.now()
  const result = computeSwayWeights(position, index, { hints: BOSS_SWAY_HINTS[key], debug: true })
  const ms = performance.now() - t0
  const n = position.length / 3
  const colors = new Float32Array(n * 3)
  const palette = [new Color(0x8a8a86), new Color(0x2f7bff), new Color(0xff8a1f), new Color(0x2fcf4f), new Color(0xe02424), new Color(0xd23cff)]
  const counts = [0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const kind = result?.kind?.[i] ?? 0
    const w = result ? result.weights[i * 2] : 0
    const part = result?.parts ? result.parts[i * 4 + 3] : 0
    counts[kind]++
    const c = palette[kind].clone()
    if (kind === 1 || kind === 2 || kind === 3) c.lerp(new Color(0xffffff), 0.55 * (1 - Math.min(1, w)))
    if (kind === 5) c.lerp(new Color(0xffffff), 0.5 * (1 - part))
    colors.set([c.r, c.g, c.b], i * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  m.material = q.get('flat') ? new MeshBasicMaterial({ vertexColors: true }) : new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })
  const box = new Box3().setFromObject(root)
  const size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3())
  const views = [0, -90, 180, 90]
  renderer.setScissorTest(true)
  views.forEach((deg, k) => {
    const holder = new Group()
    holder.add(root)
    root.position.set(-centre.x, -box.min.y, -centre.z)
    holder.rotation.y = deg * Math.PI / 180
    scene.add(holder)
    const half = size.y * 0.56
    const cam = new OrthographicCamera(-half, half, size.y * 1.06, -size.y * 0.06, -10, 10)
    cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0)
    renderer.setViewport(k * S, 0, S, S); renderer.setScissor(k * S, 0, S, S)
    renderer.render(scene, cam)
    scene.remove(holder)
  })
  document.title = `done ${JSON.stringify({ key, ms: Math.round(ms), n, counts, share: result?.share ?? 0, pieces: Boolean(result?.parts) })}`
}

function simulate(root: Group, original: Mesh) {
  const geometry = original.geometry
  const position = geometry.getAttribute('position').array as Float32Array
  const index = (geometry.index?.array ?? null) as Uint32Array | null
  const hints = BOSS_SWAY_HINTS[key]
  const sway = computeSwayWeights(position, index, { hints, internals: true })
  if (!sway?.internals) { document.title = 'done ' + JSON.stringify({ key, rigid: true }); return }
  const rig = buildPhysicsRig(position, sway.internals, { parts: sway.parts, hints, overrides: hints?.physics })
  const physics = new BossPhysics(rig, { overrides: hints?.physics })
  // the viewer's arrangement: centred on the feet, 1 unit tall, on a turntable
  const box = new Box3().setFromObject(root)
  const size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3())
  const skinned = new PhysicsMesh(geometry, original.material as Material)
  skinned.position.copy(original.position); skinned.quaternion.copy(original.quaternion); skinned.scale.copy(original.scale)
  original.parent!.add(skinned)
  original.parent!.remove(original)
  skinned.setPhysics(physics)
  const rigid = new Mesh(geometry, original.material)
  rigid.position.copy(original.position); rigid.quaternion.copy(original.quaternion); rigid.scale.copy(original.scale)
  const holder = new Group(), turntable = new Group()
  root.position.set(-centre.x, -box.min.y, -centre.z)
  holder.add(root)
  holder.scale.setScalar(1 / size.y)
  turntable.add(holder)
  scene.add(turntable)
  const walk = q.get('motion') === 'walk'
  // turn: left at 3 rad/s from 0 to 1.12 s, right at 3 rad/s from 2.5 s to 3.62 s; walk: 1.4 m/s from 0 to 3.75 s
  const moments = walk ? [0, 1.2, 2.4, 3.9, 4.4, 7] : [0, 0.6, 1.35, 3.1, 3.85, 7]
  const ramp = (t: number) => (t < 0.2 ? smoothstep(t / 0.2) : t < 1 ? 1 : t < 1.12 ? 1 - smoothstep((t - 1) / 0.12) : 0)
  const dt = 1 / 60
  let yaw = Math.PI * 0.85, z = 0
  const cam = new OrthographicCamera(-0.62, 0.62, 1.12, -0.12, -10, 10)
  renderer.setScissorTest(true)
  let shot = 0
  const report: string[] = []
  for (let frame = 0; shot < moments.length; frame++) {
    const t = frame * dt
    if (walk) {
      const go = t < 0.5 ? smoothstep(t / 0.5) : t < 3.5 ? 1 : t < 3.75 ? 1 - smoothstep((t - 3.5) / 0.25) : 0
      z += (1.4 / 1.8) * go * dt
      const phase = t * Math.PI * 2 * 1.8
      turntable.position.set((0.02 / 1.8) * Math.sin(phase / 2) * go, (0.025 / 1.8) * Math.sin(phase) * go, z)
    } else {
      yaw += 3 * (ramp(t) - (t > 2.5 ? ramp(t - 2.5) : 0)) * dt
    }
    turntable.rotation.y = yaw
    turntable.updateMatrixWorld(true)
    if (physics.step(frame === 0 ? 0 : dt, skinned.matrixWorld.elements)) skinned.invalidate()
    if (t + 1e-9 < moments[shot]) continue
    // top: with physics; bottom: the same pose rigid
    cam.position.set(turntable.position.x, 0, turntable.position.z + 5); cam.lookAt(turntable.position.x, 0, turntable.position.z)
    cam.position.y = 0; cam.updateMatrixWorld()
    renderer.setViewport(shot * S, S, S, S); renderer.setScissor(shot * S, S, S, S)
    renderer.render(scene, cam)
    skinned.parent!.add(rigid); skinned.visible = false
    renderer.setViewport(shot * S, 0, S, S); renderer.setScissor(shot * S, 0, S, S)
    renderer.render(scene, cam)
    skinned.parent!.remove(rigid); skinned.visible = true
    const metrics = physics.metrics()
    report.push(`${t.toFixed(2)}s ${(metrics.offset * 100).toFixed(1)}cm`)
    shot++
  }
  document.title = 'done ' + JSON.stringify({ key, info: rig.info, moments: report })
}

function smoothstep(t: number) { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c) }

function strain(root: Group, m: Mesh) {
  const geometry = m.geometry
  const position = geometry.getAttribute('position').array as Float32Array
  const index = (geometry.index?.array ?? null) as Uint32Array | null
  const hints = BOSS_SWAY_HINTS[key]
  const sway = computeSwayWeights(position, index, { hints, internals: true })
  if (!sway?.internals) { document.title = 'done ' + JSON.stringify({ key, rigid: true }); return }
  const rig = buildPhysicsRig(position, sway.internals, { parts: sway.parts, hints, overrides: hints?.physics })
  const physics = new BossPhysics(rig, { overrides: hints?.physics })
  const n = position.length / 3, weld = sway.internals.weld
  // vertices that follow anything but the body, and the surface's edges around them (UV seams welded)
  const moving: number[] = []
  for (let i = 0; i < n; i++) {
    if (weld[i] !== i) continue
    let other = 0
    for (let c = 0; c < 4; c++) if (rig.skinIndex[i * 4 + c] !== 0) other += rig.skinWeight[i * 4 + c]
    if (other > 1e-4) moving.push(i)
  }
  const isMoving = new Uint8Array(n)
  for (const i of moving) isMoving[i] = 1
  const edgeSet = new Set<number>()
  const tris = index ? index.length / 3 : n / 3
  for (let t = 0; t < tris; t++) for (let e = 0; e < 3; e++) {
    const a = weld[index ? index[t * 3 + e] : t * 3 + e], b = weld[index ? index[t * 3 + (e + 1) % 3] : t * 3 + (e + 1) % 3]
    if (a === b || (!isMoving[a] && !isMoving[b])) continue
    edgeSet.add(Math.min(a, b) * n + Math.max(a, b))
  }
  const edges = Int32Array.from([...edgeSet].flatMap((k) => [Math.floor(k / n), k % n]))
  const E = edges.length / 2
  const restLength = new Float32Array(E)
  for (let e = 0; e < E; e++) {
    const a = edges[e * 2] * 3, b = edges[e * 2 + 1] * 3
    restLength[e] = Math.hypot(position[a] - position[b], position[a + 1] - position[b + 1], position[a + 2] - position[b + 2])
  }
  const now = Float32Array.from(position)
  const moved = new Float32Array(n), stretch = new Float32Array(n)
  const bones = new Float32Array(physics.boneCount * 16)
  let strained20 = 0, strained50 = 0, worst = 0, worstAt = [0, 0, 0], torn3 = 0, torn8 = 0, worstEdge = -1
  const edgeWorstMm = new Float32Array(E)
  const edgeWorst = new Float32Array(E)
  const sample = () => {
    physics.writeBones(bones)
    for (const i of moving) {
      const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2]
      let px = 0, py = 0, pz = 0
      for (let c = 0; c < 4; c++) {
        const w = rig.skinWeight[i * 4 + c]
        if (!w) continue
        const o = rig.skinIndex[i * 4 + c] * 16
        px += w * (bones[o] * x + bones[o + 4] * y + bones[o + 8] * z + bones[o + 12])
        py += w * (bones[o + 1] * x + bones[o + 5] * y + bones[o + 9] * z + bones[o + 13])
        pz += w * (bones[o + 2] * x + bones[o + 6] * y + bones[o + 10] * z + bones[o + 14])
      }
      now[i * 3] = px; now[i * 3 + 1] = py; now[i * 3 + 2] = pz
      moved[i] = Math.max(moved[i], Math.hypot(px - x, py - y, pz - z) * rig.scale)
    }
    for (let e = 0; e < E; e++) {
      const a = edges[e * 2] * 3, b = edges[e * 2 + 1] * 3
      if (restLength[e] < 1e-9) continue
      const length = Math.hypot(now[a] - now[b], now[a + 1] - now[b + 1], now[a + 2] - now[b + 2])
      const s = Math.abs(length / restLength[e] - 1)
      edgeWorst[e] = Math.max(edgeWorst[e], s)
      // millimetres the edge grew or shrank (what you can see)
      const mm = Math.abs(length - restLength[e]) * rig.scale * 1000
      edgeWorstMm[e] = Math.max(edgeWorstMm[e], mm)
      for (const v of [edges[e * 2], edges[e * 2 + 1]]) if (mm > stretch[v]) stretch[v] = mm
      if (mm > worst) { worst = mm; worstAt = [position[a], position[a + 1], position[a + 2]]; worstEdge = e }
    }
  }
  // the viewer's arrangement: centred on the feet, 1 unit tall, on a turntable
  const box = new Box3().setFromObject(root)
  const size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3())
  const holder = new Group(), turntable = new Group()
  root.position.set(-centre.x, -box.min.y, -centre.z)
  holder.add(root); holder.scale.setScalar(1 / size.y); turntable.add(holder)
  const dt = 1 / 60
  const ramp = (t: number) => (t < 0.2 ? smoothstep(t / 0.2) : t < 1 ? 1 : t < 1.12 ? 1 - smoothstep((t - 1) / 0.12) : 0)
  let yaw = 0, z = 0
  physics.reset()
  for (let frame = 0; frame * dt < 14; frame++) {
    const t = frame * dt
    if (t < 7) yaw += 3 * (ramp(t) - (t > 2.5 ? ramp(t - 2.5) : 0)) * dt
    else if (t < 9) yaw += 8 * ramp((t - 7) * 3) * dt // a quick flick
    else {
      const w = t - 9, go = w < 0.5 ? smoothstep(w / 0.5) : w < 3.5 ? 1 : w < 3.75 ? 1 - smoothstep((w - 3.5) / 0.25) : 0
      z += (1.4 / 1.8) * go * dt
      const phase = w * Math.PI * 2 * 1.8
      turntable.position.set((0.02 / 1.8) * Math.sin(phase / 2) * go, (0.025 / 1.8) * Math.sin(phase) * go, z)
    }
    turntable.rotation.y = yaw
    turntable.updateMatrixWorld(true)
    physics.step(frame === 0 ? 0 : dt, m.matrixWorld.elements)
    if (frame % 2 === 0) sample()
  }
  for (let e = 0; e < E; e++) {
    if (edgeWorst[e] > 0.2) strained20++; if (edgeWorst[e] > 0.5) strained50++
    if (edgeWorstMm[e] > 3) torn3++; if (edgeWorstMm[e] > 8) torn8++
  }
  // colours: twins of a UV seam take their first vertex's values
  const colours = (value: (i: number) => [number, number, number]) => {
    const out = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) out.set(value(weld[i]), i * 3)
    return out
  }
  const grey: [number, number, number] = [0.55, 0.55, 0.53]
  const motionColour = colours((i) => {
    const k = Math.min(1, moved[i] / 0.1)
    return k <= 0.0005 ? grey : [grey[0] * (1 - k) + 0.1 * k, grey[1] * (1 - k) + 0.45 * k, grey[2] * (1 - k) + 1 * k]
  })
  const strainColour = colours((i) => {
    const s = stretch[i]
    if (s < 2) return isMoving[i] ? [0.5, 0.6, 0.7] : grey
    if (s < 6) { const k = (s - 2) / 4; return [1, 0.85 - 0.45 * k, 0.1] }
    return [0.9, 0.05, 0.05]
  })
  m.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })
  const views = [0, -90, 180, 90]
  renderer.setScissorTest(true)
  for (const [row, colour] of [[1, motionColour], [0, strainColour]] as const) {
    geometry.setAttribute('color', new BufferAttribute(colour, 3))
    views.forEach((deg, k) => {
      const view = new Group()
      root.position.set(-centre.x, -box.min.y, -centre.z)
      view.add(root)
      view.rotation.y = deg * Math.PI / 180
      scene.add(view)
      const half = size.y * 0.56
      const cam = new OrthographicCamera(-half, half, size.y * 1.06, -size.y * 0.06, -10, 10)
      cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0)
      renderer.setViewport(k * S, row * S, S, S); renderer.setScissor(k * S, row * S, S, S)
      renderer.render(scene, cam)
      scene.remove(view)
    })
  }
  let maxMove = 0
  for (const i of moving) maxMove = Math.max(maxMove, moved[i])
  const at = [(worstAt[0] - sway.internals.cx) / sway.internals.height, (worstAt[1] - sway.internals.minY) / sway.internals.height, (worstAt[2] - sway.internals.cz) / sway.internals.height].map((v) => +v.toFixed(3))
  // what the two ends of the worst edge follow: bone (0 body, then particles, then pieces) and weight, and their class
  const ends = worstEdge < 0 ? [] : [edges[worstEdge * 2], edges[worstEdge * 2 + 1]].map((v) => ({
    v, kind: sway.internals!.kind[v], w: +sway.internals!.w[v].toFixed(3), restMm: +(restLength[worstEdge] * rig.scale * 1000).toFixed(1),
    bones: [0, 1, 2, 3].filter((c) => rig.skinWeight[v * 4 + c] > 0).map((c) => {
      const bone = rig.skinIndex[v * 4 + c]
      const what = bone === 0 ? 'body' : bone <= rig.particles ? `p${bone - 1}${rig.pinned[bone - 1] ? '*' : ''}` : `piece${bone - 1 - rig.particles}`
      return `${what}:${rig.skinWeight[v * 4 + c].toFixed(2)}`
    }).join(' '),
  }))
  document.title = 'done ' + JSON.stringify({ key, moving: moving.length, maxMoveCm: +(maxMove * 100).toFixed(1), worstMm: +worst.toFixed(1), worstAt: at, mm3: torn3, mm8: torn8, strain20: strained20, strain50: strained50, worstEnds: ends, info: rig.info })
}
