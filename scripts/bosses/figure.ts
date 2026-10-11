// One boss GLB → one standing figure on a transparent canvas, with exactly the Gallery viewer's look
// (src/gallery/bossLook.ts), so the Overview stills and the live 3D view match. Driven by render-figures.mjs.
// Every figure is drawn at the same scale per body height (feet to the top of the head, not counting a raised
// rifle, antlers or horns), so bosses standing side by side on a map card are the same size in the game world.
import { Box3, BufferGeometry, Group, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CAMERA, FOV, LOOK_AT_Y, START_YAW_DEG, headTop } from '../../src/gallery/bossFraming'
import { applyBossLighting, gradeBossMaterial } from '../../src/gallery/bossLook'

const q = new URLSearchParams(location.search)
const H = +(q.get('h') || 900), W = Math.round(H * 0.75)
const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.width = W; canvas.height = H
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setSize(W, H, false)
renderer.setClearColor(0x000000, 0)
const scene = new Scene()
applyBossLighting(renderer, scene)
const yaw = +(q.get('yaw') || START_YAW_DEG) * Math.PI / 180

/** World-space vertices (x, y, z) of every mesh under root. */
function points(root: Object3D): Float32Array {
  const out: number[] = []
  const v = new Vector3()
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const position = (mesh.geometry as BufferGeometry).getAttribute('position')
    for (let i = 0; i < position.count; i++) { v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld); out.push(v.x, v.y, v.z) }
  })
  return Float32Array.from(out)
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
  // the Gallery viewer's start view (src/gallery/bossFraming.ts): FRAME body heights tall at the figure
  const camera = new PerspectiveCamera(FOV, W / H, 0.1, 50)
  camera.position.set(0, CAMERA.y, CAMERA.z); camera.lookAt(0, LOOK_AT_Y, 0)
  renderer.render(scene, camera)
  // pixels per body height at the figure's centre line (what the Overview scales by)
  const project = (y: number) => new Vector3(0, y, 0).project(camera).y
  const bodyPx = (project(1) - project(0)) / 2 * H
  document.title = `done ${bodyPx.toFixed(2)} ${(body / size.y).toFixed(3)}`
}, undefined, (error) => { document.title = 'err ' + String(error) })
