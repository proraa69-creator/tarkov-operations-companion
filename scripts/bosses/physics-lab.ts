// Lab page for the boss models' loose parts, driven by physics-lab.mjs.
// ?mode=classes: colours every vertex by the sway analysis class (grey body, blue cloth, orange cord/hair/antenna,
//   green pouch, red held rigid, magenta whole piece) and renders four views (front, right, back, left) side by side.
// ?mode=sim (&motion=turn|walk): runs the secondary physics (src/gallery/physics) through a scripted motion and renders
//   six moments: top row with physics, bottom row the same pose rigid. turn: rest, turning left, just after an abrupt
//   stop, turning right, just after the stop, settled; walk: rest, walking, walking, just after the stop, settling, settled.
import { BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Scene, WebGLRenderer, Box3, Vector3, AmbientLight, DirectionalLight, type Material } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { computeSwayWeights } from '../../src/gallery/swayWeights'
import { BOSS_SWAY_HINTS } from '../../src/gallery/bossSwayHints'
import { buildPhysicsRig } from '../../src/gallery/physics/rig'
import { BossPhysics } from '../../src/gallery/physics/sim'
import { PhysicsMesh } from '../../src/gallery/physics/skin'

const q = new URLSearchParams(location.search)
const key = q.get('key') ?? ''
const mode = q.get('mode') ?? 'classes'
const S = +(q.get('s') || 420)
const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setSize(mode === 'sim' ? S * 6 : S * 4, mode === 'sim' ? S * 2 : S, false)
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
