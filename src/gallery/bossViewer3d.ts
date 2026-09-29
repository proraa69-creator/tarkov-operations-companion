/**
 * The Gallery's single 3D boss viewer. Loaded with a dynamic import only when a card is opened, so three.js
 * never reaches the main bundle. Rendering is on demand: a frame is drawn only while the model is being dragged,
 * easing to a stop, loading, or (opt-in) slowly spinning — an idle, still viewer costs nothing. Spinning also
 * stops while the canvas is off screen or the window is hidden, and runs at most ~30 fps.
 */
import {
  AgXToneMapping, Box3, DirectionalLight, Group, HemisphereLight, PMREMGenerator, PerspectiveCamera, SRGBColorSpace,
  Scene, Vector3, WebGLRenderer, type Material, type Mesh, type Object3D, type Texture,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { BossModelFix } from '../data/bossModels'

export interface BossViewerHandle {
  /** Swap to another model; the renderer and lights are kept. */
  load(url: string, fix?: BossModelFix): void
  resetView(): void
  setSpin(on: boolean): void
  dispose(): void
}

const DEG = Math.PI / 180
const START_YAW = -18 * DEG
const PITCH_LIMIT = 18 * DEG
const DIST_MIN = 1.7, DIST_MAX = 4.2, DIST_START = 3.1
const TARGET = new Vector3(0, 0.5, 0)
const SPIN_SPEED = 0.35 // rad/s
const FRAME_MS = 1000 / 30

export function mountBossViewer(canvas: HTMLCanvasElement, options: { reduced: boolean; onLoading?: (loading: boolean) => void; onError?: () => void }): BossViewerHandle {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.outputColorSpace = SRGBColorSpace

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = environment
  scene.environmentIntensity = 0.55
  scene.add(new HemisphereLight(0xf1e6cf, 0x1b1d17, 0.7))
  const key = new DirectionalLight(0xfff1dc, 2.4); key.position.set(-2.2, 3.2, 3); scene.add(key)
  const rim = new DirectionalLight(0x9fc4dc, 2.2); rim.position.set(2.6, 1.8, -2.6); scene.add(rim)
  const fill = new DirectionalLight(0xd9c79b, 0.45); fill.position.set(2.5, 0.5, 3); scene.add(fill)

  const camera = new PerspectiveCamera(22, 1, 0.05, 50)
  // The turntable: the model turns (so the lights stay put relative to the viewer), the camera tilts and zooms.
  const turntable = new Group()
  scene.add(turntable)

  let yaw = START_YAW, pitch = 4 * DEG, dist = DIST_START
  let yawVelocity = 0
  let spin = false
  let dragging = false
  let visible = true
  let raf = 0
  let lastFrame = 0
  let loadToken = 0
  let disposed = false
  const loader = new GLTFLoader()

  function resize() {
    const width = canvas.clientWidth || 1, height = canvas.clientHeight || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function draw() {
    turntable.rotation.y = yaw
    camera.position.set(0, TARGET.y + Math.sin(pitch) * dist, Math.cos(pitch) * dist)
    camera.lookAt(TARGET)
    renderer.render(scene, camera)
  }

  const spinning = () => spin && !options.reduced && visible && !dragging
  function frame(now: number) {
    raf = 0
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0
    if (spinning() && lastFrame && now - lastFrame < FRAME_MS) { raf = requestAnimationFrame(frame); return }
    lastFrame = now
    if (!dragging && Math.abs(yawVelocity) > 0.02) {
      yaw += yawVelocity * dt
      yawVelocity *= Math.pow(0.02, dt) // inertia fades out in about a second
    } else if (!dragging) yawVelocity = 0
    if (spinning()) yaw += SPIN_SPEED * dt
    draw()
    if (visible && (spinning() || yawVelocity !== 0)) raf = requestAnimationFrame(frame)
    else lastFrame = 0
  }
  function invalidate() { if (!raf && !disposed) raf = requestAnimationFrame(frame) }

  // Pointer: drag = turn (and a little tilt), wheel = zoom within limits, double-click = reset.
  let lastX = 0, lastY = 0, lastT = 0
  const onDown = (event: PointerEvent) => {
    dragging = true; yawVelocity = 0
    lastX = event.clientX; lastY = event.clientY; lastT = performance.now()
    canvas.setPointerCapture(event.pointerId)
  }
  const onMove = (event: PointerEvent) => {
    if (!dragging) return
    const dx = event.clientX - lastX, dy = event.clientY - lastY
    const now = performance.now()
    const turn = dx * 0.0105
    yaw += turn
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + dy * 0.005))
    yawVelocity = turn / Math.max(0.008, (now - lastT) / 1000)
    lastX = event.clientX; lastY = event.clientY; lastT = now
    invalidate()
  }
  const onUp = (event: PointerEvent) => {
    if (!dragging) return
    dragging = false
    if (performance.now() - lastT > 80 || options.reduced) yawVelocity = 0
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    invalidate()
  }
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    dist = Math.max(DIST_MIN, Math.min(DIST_MAX, dist * Math.exp(event.deltaY * 0.0012)))
    invalidate()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') yaw -= 15 * DEG
    else if (event.key === 'ArrowRight') yaw += 15 * DEG
    else if (event.key === '+' || event.key === '=') dist = Math.max(DIST_MIN, dist * 0.88)
    else if (event.key === '-') dist = Math.min(DIST_MAX, dist / 0.88)
    else return
    event.preventDefault()
    invalidate()
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('keydown', onKey)
  canvas.addEventListener('dblclick', resetView)

  // Pause when the viewer is off screen or the window is hidden; redraw once when it comes back.
  const updateVisible = (onScreen: boolean) => {
    visible = onScreen && document.visibilityState === 'visible'
    if (visible) invalidate()
  }
  let onScreen = true
  const io = new IntersectionObserver(([entry]) => { onScreen = !!entry?.isIntersecting; updateVisible(onScreen) })
  io.observe(canvas)
  const onVisibility = () => updateVisible(onScreen)
  document.addEventListener('visibilitychange', onVisibility)
  const ro = new ResizeObserver(() => { resize(); invalidate() })
  ro.observe(canvas)
  resize()

  function load(url: string, fix?: BossModelFix) {
    const token = ++loadToken
    options.onLoading?.(true)
    loader.load(url, (gltf) => {
      if (disposed || token !== loadToken) { release(gltf.scene); return }
      for (const child of [...turntable.children]) { turntable.remove(child); release(child) }
      const model = gltf.scene
      // Straighten first (about the feet), then stand the result on the floor, centred, 1 unit tall.
      const upright = new Group()
      upright.add(model)
      upright.rotation.z = (fix?.rollDeg ?? 0) * DEG
      upright.updateMatrixWorld(true)
      const box = new Box3().setFromObject(upright)
      const size = box.getSize(new Vector3())
      const centre = box.getCenter(new Vector3())
      const holder = new Group()
      upright.position.set(-centre.x, -box.min.y, -centre.z)
      holder.add(upright)
      holder.scale.setScalar(1 / Math.max(size.y, 1e-6))
      turntable.add(holder)
      options.onLoading?.(false)
      invalidate()
    }, undefined, () => {
      if (token !== loadToken || disposed) return
      options.onLoading?.(false)
      options.onError?.()
    })
  }

  function resetView() {
    yaw = START_YAW; pitch = 4 * DEG; dist = DIST_START; yawVelocity = 0
    invalidate()
  }

  return {
    load,
    resetView,
    setSpin(on) { spin = on; lastFrame = 0; invalidate() },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      io.disconnect(); ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKey)
      canvas.removeEventListener('dblclick', resetView)
      release(turntable)
      environment.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

/** Frees the GPU buffers and textures of a loaded model. */
function release(root: Object3D) {
  const materials = new Set<Material>()
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) (value as Texture).dispose()
    material.dispose()
  }
}
