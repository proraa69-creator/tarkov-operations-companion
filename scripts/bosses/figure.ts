// One boss GLB → one standing figure on a transparent canvas, with exactly the Gallery viewer's look
// (src/gallery/bossLook.ts), so the Overview stills and the live 3D view match. Driven by render-figures.mjs.
import { Box3, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Material, type Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
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
const yaw = +(q.get('yaw') || -18) * Math.PI / 180

new GLTFLoader().load(q.get('m') ?? '', (gltf) => {
  const model = gltf.scene
  model.traverse((object) => { const mesh = object as Mesh; if (mesh.isMesh) gradeBossMaterial(mesh.material as Material) })
  // same framing as before: straightened about the feet, standing on the floor, 1 unit tall
  const upright = new Group(); upright.add(model); upright.rotation.z = +(q.get('roll') || 0) * Math.PI / 180
  upright.updateMatrixWorld(true)
  const box = new Box3().setFromObject(upright), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3())
  upright.position.set(-centre.x, -box.min.y, -centre.z)
  const holder = new Group(); holder.add(upright); holder.rotation.y = yaw
  holder.scale.setScalar(1 / size.y); scene.add(holder)
  const camera = new PerspectiveCamera(22, W / H, 0.1, 50)
  camera.position.set(0, 0.62, 3.1); camera.lookAt(0, 0.5, 0)
  renderer.render(scene, camera)
  document.title = 'done'
}, undefined, (error) => { document.title = 'err ' + String(error) })
