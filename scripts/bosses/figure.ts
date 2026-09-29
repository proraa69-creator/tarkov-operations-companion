// One boss GLB → one standing figure on a transparent canvas, with exactly the Gallery viewer's look
// (src/gallery/bossLook.ts), so the Overview stills and the live 3D view match. Driven by render-figures.mjs.
// Every figure is drawn at the same scale per body height (feet to the top of the head, not counting a raised
// rifle, antlers or horns), so bosses standing side by side on a map card are the same size in the game world.
import { Box3, BufferGeometry, Group, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { applyBossLighting, gradeBossMaterial } from '../../src/gallery/bossLook'

const q = new URLSearchParams(location.search)
const H = +(q.get('h') || 900), W = Math.round(H * 0.75)
/** Visible height in body heights (room for what sticks up above the head). */
const FRAME = 1.34
const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.width = W; canvas.height = H
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setSize(W, H, false)
renderer.setClearColor(0x000000, 0)
const scene = new Scene()
applyBossLighting(renderer, scene)
const yaw = +(q.get('yaw') || -18) * Math.PI / 180

/** World-space vertices of every mesh under root. */
function points(root: Object3D): Vector3[] {
  const out: Vector3[] = []
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const position = (mesh.geometry as BufferGeometry).getAttribute('position')
    for (let i = 0; i < position.count; i++) out.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
  })
  return out
}

/**
 * Height of the top of the head above the feet: the highest slice of the column over the torso that is still
 * head-wide (antennas, antlers, horn tips and raised barrels are narrow or off to the side).
 */
function headTop(vertices: Vector3[], minY: number, height: number): number {
  // centred on the neck and lower head, which a shield, a sword or a rifle held at the hip cannot pull aside
  const torso = vertices.filter((v) => v.y > minY + 0.8 * height && v.y < minY + 0.9 * height)
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? 0
  const cx = median(torso.map((v) => v.x)), cz = median(torso.map((v) => v.z))
  const column = vertices.filter((v) => Math.hypot(v.x - cx, v.z - cz) < 0.09 * height && v.y > minY + 0.6 * height)
  const SLICE = 0.01 * height
  for (let top = minY + height; top > minY + 0.6 * height; top -= SLICE) {
    const slice = column.filter((v) => v.y <= top && v.y > top - SLICE)
    if (slice.length < 6) continue
    const xs = slice.map((v) => v.x), zs = slice.map((v) => v.z)
    if (Math.max(...xs) - Math.min(...xs) > 0.06 * height && Math.max(...zs) - Math.min(...zs) > 0.06 * height) return top - minY
  }
  return height
}

new GLTFLoader().load(q.get('m') ?? '', (gltf) => {
  const model = gltf.scene
  model.traverse((object) => { const mesh = object as Mesh; if (mesh.isMesh) gradeBossMaterial(mesh.material as Material) })
  // straightened about the feet, standing on the floor, one body height tall
  const upright = new Group(); upright.add(model); upright.rotation.z = +(q.get('roll') || 0) * Math.PI / 180
  upright.updateMatrixWorld(true)
  const box = new Box3().setFromObject(upright), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3())
  const body = headTop(points(upright), box.min.y, size.y) / +(q.get('seated') || 1)
  upright.position.set(-centre.x, -box.min.y, -centre.z)
  const holder = new Group(); holder.add(upright); holder.rotation.y = yaw
  holder.scale.setScalar(1 / body); scene.add(holder)
  const distance = 3.1 * FRAME / 1.2
  const camera = new PerspectiveCamera(22, W / H, 0.1, 50)
  camera.position.set(0, 0.62 * FRAME / 1.2, distance); camera.lookAt(0, 0.5 * FRAME / 1.2, 0)
  renderer.render(scene, camera)
  // pixels per body height at the figure's centre line (what the Overview scales by)
  const project = (y: number) => new Vector3(0, y, 0).project(camera).y
  const bodyPx = (project(1) - project(0)) / 2 * H
  document.title = `done ${bodyPx.toFixed(2)} ${(body / size.y).toFixed(3)}`
}, undefined, (error) => { document.title = 'err ' + String(error) })
