// Lab page for the boss models' loose parts. ?mode=classes: colours every vertex by the sway analysis class
// (grey body, blue cloth, orange cord/hair/antenna, green pouch, red held rigid, magenta whole piece) and renders
// four views (front, right, back, left) side by side. Driven by physics-lab.mjs.
import { BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Scene, WebGLRenderer, Box3, Vector3, AmbientLight, DirectionalLight } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { computeSwayWeights } from '../../src/gallery/swayWeights'
import { BOSS_SWAY_HINTS } from '../../src/gallery/bossSwayHints'

const q = new URLSearchParams(location.search)
const key = q.get('key') ?? ''
const S = +(q.get('s') || 420)
const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setSize(S * 4, S, false)
renderer.setClearColor(0x202322, 1)
const scene = new Scene()
scene.add(new AmbientLight(0xffffff, 1.4))
const sun = new DirectionalLight(0xffffff, 1.6); sun.position.set(1, 2, 3); scene.add(sun)

new GLTFLoader().load(q.get('m') ?? '', (gltf) => {
  let mesh: Mesh | null = null
  gltf.scene.traverse((o) => { if ((o as Mesh).isMesh) mesh = o as Mesh })
  if (!mesh) { document.title = 'err no mesh'; return }
  const m = mesh as Mesh
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
  const box = new Box3().setFromObject(gltf.scene)
  const size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3())
  const views = [0, -90, 180, 90]
  renderer.setScissorTest(true)
  views.forEach((deg, k) => {
    const holder = new Group()
    holder.add(gltf.scene)
    gltf.scene.position.set(-centre.x, -box.min.y, -centre.z)
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
}, undefined, (error) => { document.title = 'err ' + String(error) })
