/**
 * The Gallery's single 3D boss viewer. Loaded with a dynamic import only when a card is opened, so three.js
 * never reaches the main bundle. Rendering is on demand: frames are drawn only while the model is dragged,
 * easing to a stop, its cloth is still swinging, it is loading, or (opt-in) slowly spinning. After a turn the
 * loose cloth breathes in a faint breeze for a few seconds at a low frame rate and then the loop stops, so an
 * idle viewer costs nothing. Nothing is drawn while the canvas is off screen or the window is hidden.
 * The look (tone mapping, lights, material grade) is shared with the Overview stills: bossLook.ts.
 */
import {
  Box3, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
  type BufferAttribute, type Material, type Mesh, type Object3D, type Texture,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { BossModelFix } from '../data/bossModels'
import { applyBossLighting, gradeBossMaterial } from './bossLook'
import { addSway, type Sway } from './swayMaterial'
import { computeSwayWeights, type SwayWeights } from './swayWeights'
import type { SwayReply, SwayRequest } from './swayWeights.worker'
import SwayWorker from './swayWeights.worker?worker&inline'

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
const SPIN_FRAME_MS = 1000 / 30
const IDLE_FRAME_MS = 1000 / 24
/** How long the idle breeze lasts after the last interaction, and its fade-out at the end. */
const BREEZE_MS = 9000, BREEZE_FADE_MS = 2500

export function mountBossViewer(canvas: HTMLCanvasElement, options: { reduced: boolean; onLoading?: (loading: boolean) => void; onError?: () => void }): BossViewerHandle {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setClearColor(0x000000, 0)
  const scene = new Scene()
  const disposeLighting = applyBossLighting(renderer, scene)

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
  let sways: Sway[] = []
  let swaying = false
  let lastYaw = yaw
  let breezeUntil = 0
  /** The current model has loose parts with weights (otherwise there is nothing to breeze). */
  let clothReady = false
  const loader = new GLTFLoader()
  const weights = createWeightSolver()

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

  const animated = !options.reduced
  const spinning = () => spin && animated && visible && !dragging
  /** Breeze strength 0..1: on after an interaction, fading out, then off (the loop may stop). */
  const breeze = (now: number) => (animated && clothReady ? Math.max(0, Math.min(1, (breezeUntil - now) / BREEZE_FADE_MS)) : 0)
  const wake = () => { breezeUntil = performance.now() + BREEZE_MS }

  function frame(now: number) {
    raf = 0
    const busy = dragging || yawVelocity !== 0 || swaying
    // idle motion (spin, breeze) runs at a reduced frame rate
    const minGap = busy ? 0 : spinning() ? SPIN_FRAME_MS : IDLE_FRAME_MS
    if (lastFrame && now - lastFrame < minGap - 1) { raf = requestAnimationFrame(frame); return }
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0
    lastFrame = now
    if (!dragging && Math.abs(yawVelocity) > 0.02) {
      yaw += yawVelocity * dt
      yawVelocity *= Math.pow(0.02, dt) // inertia fades out in about a second
    } else if (!dragging) yawVelocity = 0
    if (spinning()) yaw += SPIN_SPEED * dt
    // loose cloth follows the turning speed (dragging included) until it settles
    const wind = breeze(now)
    const turnSpeed = dt > 0 ? (yaw - lastYaw) / dt : 0
    swaying = false
    if (animated && dt > 0) for (const sway of sways) swaying = sway.step(turnSpeed, dt, wind) || swaying
    lastYaw = yaw
    draw()
    if (visible && (spinning() || yawVelocity !== 0 || swaying || dragging || wind > 0)) raf = requestAnimationFrame(frame)
    else lastFrame = 0
  }
  function invalidate() { if (!raf && !disposed && visible) raf = requestAnimationFrame(frame) }

  // Pointer: drag = turn (and a little tilt), wheel or two-finger pinch = zoom within limits,
  // double-click / double-tap = reset. Touch works through the same pointer events (the canvas has touch-action: none).
  let lastX = 0, lastY = 0, lastT = 0
  const pointers = new Map<number, { x: number; y: number }>()
  let pinchSpan = 0, pinchDist = dist
  let lastTap = 0, tapX = 0, tapY = 0, moved = 0
  const span = () => {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  const onDown = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvas.setPointerCapture(event.pointerId)
    yawVelocity = 0
    wake()
    if (pointers.size === 2) {
      // Second finger: stop turning and start pinching from the current zoom.
      dragging = false
      pinchSpan = span()
      pinchDist = dist
      return
    }
    if (pointers.size > 2) return
    dragging = true; moved = 0
    lastX = event.clientX; lastY = event.clientY; lastT = performance.now()
  }
  const onMove = (event: PointerEvent) => {
    const tracked = pointers.get(event.pointerId)
    if (tracked) { tracked.x = event.clientX; tracked.y = event.clientY }
    if (pointers.size >= 2) {
      const current = span()
      if (pinchSpan > 0 && current > 0) {
        dist = Math.max(DIST_MIN, Math.min(DIST_MAX, pinchDist * (pinchSpan / current)))
        invalidate()
      }
      return
    }
    if (!dragging) return
    const dx = event.clientX - lastX, dy = event.clientY - lastY
    const now = performance.now()
    const turn = dx * 0.0105
    moved += Math.abs(dx) + Math.abs(dy)
    yaw += turn
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + dy * 0.005))
    yawVelocity = turn / Math.max(0.008, (now - lastT) / 1000)
    lastX = event.clientX; lastY = event.clientY; lastT = now
    wake()
    invalidate()
  }
  const onUp = (event: PointerEvent) => {
    const wasPinch = pointers.size >= 2
    pointers.delete(event.pointerId)
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (wasPinch) {
      // One finger left after a pinch: continue as a drag from where it is, without a jump.
      const rest = [...pointers.values()][0]
      if (rest) { dragging = true; lastX = rest.x; lastY = rest.y; lastT = performance.now(); moved = 99 }
      return
    }
    if (!dragging) return
    dragging = false
    if (performance.now() - lastT > 80 || options.reduced) yawVelocity = 0
    // Double tap (touch has no reliable dblclick): two quick taps close together reset the view.
    if (event.pointerType === 'touch' && moved < 8 && event.type === 'pointerup') {
      const now = performance.now()
      if (now - lastTap < 320 && Math.hypot(event.clientX - tapX, event.clientY - tapY) < 30) { lastTap = 0; resetView(); return }
      lastTap = now; tapX = event.clientX; tapY = event.clientY
    }
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
    wake()
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
    if (!visible) { cancelAnimationFrame(raf); raf = 0; lastFrame = 0 } else invalidate()
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
      sways = []
      swaying = false
      clothReady = false
      model.traverse((object) => {
        const mesh = object as Mesh
        if (!mesh.isMesh) return
        if (!animated) { gradeBossMaterial(mesh.material as Material); return }
        // graded and rigged at once (one shader compile); the weights arrive a moment later from the worker
        const sway = addSway(mesh)
        sways.push(sway)
        const position = (mesh.geometry.getAttribute('position') as BufferAttribute).array as Float32Array
        const index = (mesh.geometry.index?.array ?? null) as Uint32Array | Uint16Array | null
        weights.solve(position, index).then((data) => {
          if (disposed || token !== loadToken || !data) return
          sway.setWeights(data)
          clothReady = true
          wake()
          invalidate()
        }, () => { /* no weights: the model simply stays rigid */ })
      })
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
      weights.dispose()
      release(turntable)
      disposeLighting()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

/**
 * Cloth weights are computed in a worker (inline, so it also works from file:// in the desktop build);
 * if a worker cannot be started they are computed on the main thread once the model is already on screen.
 */
function createWeightSolver() {
  let worker: Worker | null = null
  try { worker = new SwayWorker() } catch { worker = null }
  let nextId = 0
  let disposed = false
  const pending = new Map<number, { resolve: (data: SwayWeights | null) => void; position: Float32Array; index: Uint32Array | Uint16Array | null }>()
  const onMainThread = (position: Float32Array, index: Uint32Array | Uint16Array | null) => new Promise<SwayWeights | null>((resolve) => setTimeout(() => {
    if (disposed) { resolve(null); return }
    try { resolve(computeSwayWeights(position, index)) } catch { resolve(null) }
  }, 120))
  if (worker) {
    worker.onmessage = (event: MessageEvent<SwayReply>) => {
      pending.get(event.data.id)?.resolve(event.data.result)
      pending.delete(event.data.id)
    }
    // the worker could not start (or crashed): finish what was asked on the main thread
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      for (const job of pending.values()) void onMainThread(job.position, job.index).then(job.resolve)
      pending.clear()
    }
  }
  return {
    solve(position: Float32Array, index: Uint32Array | Uint16Array | null): Promise<SwayWeights | null> {
      if (!worker) return onMainThread(position, index)
      const id = ++nextId
      // copies go to the worker; the originals stay in the geometry
      const request: SwayRequest = { id, position: position.slice(), index: index ? index.slice() : null }
      return new Promise((resolve) => {
        pending.set(id, { resolve, position, index })
        worker!.postMessage(request, [request.position.buffer, ...(request.index ? [request.index.buffer] : [])])
      })
    },
    dispose() {
      disposed = true
      worker?.terminate()
      worker = null
      pending.clear()
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
