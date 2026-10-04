/**
 * The Gallery's single 3D boss viewer. Loaded with a dynamic import only when a card is opened, so three.js
 * never reaches the main bundle. Rendering is on demand: frames are drawn only while the model is dragged,
 * easing to a stop, turning to a key press or a reset, its loose parts are still moving, it is loading, or (opt-in)
 * slowly spinning; then the loop stops, so an idle viewer costs nothing. Nothing is drawn while the canvas is off
 * screen or the window is hidden.
 * Secondary physics (physics/): capes, cloaks and coat hems, straps and slings, hair and dreads, antennas, pouches
 * and gear follow the model's real motion — its world matrix goes into the simulation every frame — so a turn makes
 * them lag, flare and swing, and they settle once it stops. The body, the weapons and rigid armour never move.
 * The look (tone mapping, lights, material grade) is shared with the Overview stills: bossLook.ts.
 */
import {
  Box3, Group, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer,
  type BufferAttribute, type Material, type Mesh, type Object3D, type Texture,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { BossModelFix } from '../data/bossModels'
import { applyBossLighting, gradeBossMaterial } from './bossLook'
import type { BossSwayHints } from './bossSwayHints'
import { rigFromMesh, type PhysicsRig } from './physics/rig'
import type { RigReply, RigRequest } from './physics/rig.worker'
import RigWorker from './physics/rig.worker?worker&inline'
import { BossPhysics } from './physics/sim'
import { PhysicsMesh } from './physics/skin'

export interface BossViewerHandle {
  /** Swap to another model; the renderer and lights are kept. `hints`: the model's loose-part hints (bossSwayHints.ts). */
  load(url: string, fix?: BossModelFix, hints?: BossSwayHints): void
  resetView(): void
  setSpin(on: boolean): void
  dispose(): void
}

const DEG = Math.PI / 180
const START_YAW = -18 * DEG
const START_PITCH = 4 * DEG
const PITCH_LIMIT = 18 * DEG
const DIST_MIN = 1.7, DIST_MAX = 4.2, DIST_START = 3.1
const TARGET = new Vector3(0, 0.5, 0)
const SPIN_SPEED = 0.35 // rad/s
const SPIN_FRAME_MS = 1000 / 30
/** An arrow key turns by KEY_TURN in KEY_TURN_MS and a reset eases back in RESET_MS: real turns the cloth follows. */
const KEY_TURN = 15 * DEG, KEY_TURN_MS = 280, RESET_MS = 650

/** A model with secondary physics: its skinned mesh and the simulation behind it. */
interface Loose { mesh: PhysicsMesh; physics: BossPhysics }
/** An eased turn of the view (keys, reset); pitch and distance only when they change. */
interface Turn { start: number; duration: number; yaw: [number, number]; pitch?: [number, number]; dist?: [number, number] }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
/** The same angle within (−π, π]. */
const wrap = (angle: number) => angle - Math.ceil((angle - Math.PI) / (2 * Math.PI)) * 2 * Math.PI

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

  let yaw = START_YAW, pitch = START_PITCH, dist = DIST_START
  let yawVelocity = 0
  let turn: Turn | null = null
  let spin = false
  let dragging = false
  let visible = true
  let raf = 0
  let lastFrame = 0
  let loadToken = 0
  let disposed = false
  let loose: Loose[] = []
  /** Some loose part is still moving (the simulation is awake). */
  let moving = false
  const loader = new GLTFLoader()
  const rigs = createRigSolver()

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

  function frame(now: number) {
    raf = 0
    const busy = dragging || yawVelocity !== 0 || turn !== null || moving
    // the slow spin alone runs at a reduced frame rate
    const minGap = busy ? 0 : spinning() ? SPIN_FRAME_MS : 0
    if (lastFrame && now - lastFrame < minGap - 1) { raf = requestAnimationFrame(frame); return }
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0
    lastFrame = now
    if (turn) {
      const t = Math.min(1, (now - turn.start) / turn.duration), e = easeInOut(t)
      yaw = turn.yaw[0] + (turn.yaw[1] - turn.yaw[0]) * e
      if (turn.pitch) pitch = turn.pitch[0] + (turn.pitch[1] - turn.pitch[0]) * e
      if (turn.dist) dist = turn.dist[0] + (turn.dist[1] - turn.dist[0]) * e
      if (t >= 1) turn = null
    } else if (!dragging && Math.abs(yawVelocity) > 0.02) {
      yaw += yawVelocity * dt
      yawVelocity *= Math.pow(0.02, dt) // inertia fades out in about a second
    } else if (!dragging) yawVelocity = 0
    if (spinning()) yaw += SPIN_SPEED * dt
    // the loose parts feel the model's real motion this frame: its world matrix, turntable included
    turntable.rotation.y = yaw
    turntable.updateMatrixWorld(true)
    moving = false
    for (const part of loose) {
      const wasAwake = !part.physics.sleeping
      const awake = part.physics.step(dt, part.mesh.matrixWorld.elements)
      if (awake) moving = true
      // the bones go to the GPU while it moves, and once more as it comes to rest
      if (awake || wasAwake) part.mesh.invalidate()
    }
    draw()
    if (visible && (spinning() || yawVelocity !== 0 || turn || moving || dragging)) raf = requestAnimationFrame(frame)
    else lastFrame = 0
  }

  /** Eases the view to a new angle (and pitch and distance), as a real turn the loose parts react to. */
  function turnTo(target: { yaw: number; pitch?: number; dist?: number }, duration: number) {
    if (!animated) {
      yaw = target.yaw; pitch = target.pitch ?? pitch; dist = target.dist ?? dist
      invalidate()
      return
    }
    turn = {
      start: performance.now(), duration, yaw: [yaw, target.yaw],
      ...(target.pitch !== undefined ? { pitch: [pitch, target.pitch] as [number, number] } : {}),
      ...(target.dist !== undefined ? { dist: [dist, target.dist] as [number, number] } : {}),
    }
    yawVelocity = 0
    invalidate()
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
    turn = null
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
    const step = dx * 0.0105
    moved += Math.abs(dx) + Math.abs(dy)
    yaw += step
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + dy * 0.005))
    yawVelocity = step / Math.max(0.008, (now - lastT) / 1000)
    lastX = event.clientX; lastY = event.clientY; lastT = now
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
    // a key press adds to a turn still under way
    if (event.key === 'ArrowLeft') turnTo({ yaw: (turn ? turn.yaw[1] : yaw) - KEY_TURN }, KEY_TURN_MS)
    else if (event.key === 'ArrowRight') turnTo({ yaw: (turn ? turn.yaw[1] : yaw) + KEY_TURN }, KEY_TURN_MS)
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

  function load(url: string, fix?: BossModelFix, hints?: BossSwayHints) {
    const token = ++loadToken
    options.onLoading?.(true)
    loader.load(url, (gltf) => {
      if (disposed || token !== loadToken) { release(gltf.scene); return }
      for (const child of [...turntable.children]) { turntable.remove(child); release(child) }
      // a new model starts its physics from rest
      loose = []
      moving = false
      const model = gltf.scene
      const meshes: Mesh[] = []
      model.traverse((object) => { if ((object as Mesh).isMesh) meshes.push(object as Mesh) })
      const skinned: PhysicsMesh[] = []
      for (const mesh of meshes) {
        gradeBossMaterial(mesh.material as Material)
        if (!animated) continue
        // graded and skinned at once (one shader compile); rigid until its rig arrives from the worker
        const physicsMesh = new PhysicsMesh(mesh.geometry, mesh.material)
        physicsMesh.name = mesh.name
        physicsMesh.position.copy(mesh.position); physicsMesh.quaternion.copy(mesh.quaternion); physicsMesh.scale.copy(mesh.scale)
        for (const child of [...mesh.children]) physicsMesh.add(child)
        mesh.parent!.add(physicsMesh)
        mesh.parent!.remove(mesh)
        skinned.push(physicsMesh)
      }
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
      turntable.updateMatrixWorld(true)
      for (const mesh of skinned) {
        // up in the mesh's own space as the model stands here: the model was sculpted hanging under the opposite gravity
        const up = new Vector3(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(new Quaternion()).invert())
        const position = (mesh.geometry.getAttribute('position') as BufferAttribute).array as Float32Array
        const index = (mesh.geometry.index?.array ?? null) as Uint32Array | Uint16Array | null
        rigs.solve(position, index, hints, [up.x, up.y, up.z]).then((rig) => {
          if (disposed || token !== loadToken || !rig || rig.particles + rig.pieces === 0) return
          const physics = new BossPhysics(rig, { overrides: hints?.physics })
          mesh.setPhysics(physics)
          loose.push({ mesh, physics })
          invalidate()
        }, () => { /* no rig: the model simply stays rigid */ })
      }
      options.onLoading?.(false)
      invalidate()
    }, undefined, () => {
      if (token !== loadToken || disposed) return
      options.onLoading?.(false)
      options.onError?.()
    })
  }

  function resetView() {
    // the way round to the start angle that is shortest from here
    turnTo({ yaw: yaw + wrap(START_YAW - yaw), pitch: START_PITCH, dist: DIST_START }, RESET_MS)
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
      rigs.dispose()
      release(turntable)
      disposeLighting()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

/**
 * Physics rigs are built in a worker (inline, so it also works from file:// in the desktop build); if a worker cannot
 * be started they are built on the main thread once the model is already on screen.
 */
function createRigSolver() {
  let worker: Worker | null = null
  try { worker = new RigWorker() } catch { worker = null }
  let nextId = 0
  let disposed = false
  type Job = Omit<RigRequest, 'id'>
  const pending = new Map<number, { resolve: (rig: PhysicsRig | null) => void; job: Job }>()
  const onMainThread = (job: Job) => new Promise<PhysicsRig | null>((resolve) => setTimeout(() => {
    if (disposed) { resolve(null); return }
    try { resolve(rigFromMesh(job.position, job.index, job.hints, job.up)) } catch { resolve(null) }
  }, 120))
  if (worker) {
    worker.onmessage = (event: MessageEvent<RigReply>) => {
      pending.get(event.data.id)?.resolve(event.data.rig)
      pending.delete(event.data.id)
    }
    // the worker could not start (or crashed): finish what was asked on the main thread
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      for (const { resolve, job } of pending.values()) void onMainThread(job).then(resolve)
      pending.clear()
    }
  }
  return {
    solve(position: Float32Array, index: Uint32Array | Uint16Array | null, hints: BossSwayHints | undefined, up: [number, number, number]): Promise<PhysicsRig | null> {
      if (!worker) return onMainThread({ position, index, hints, up })
      const id = ++nextId
      // copies go to the worker; the originals stay in the geometry
      const request: RigRequest = { id, position: position.slice(), index: index ? index.slice() : null, hints, up }
      return new Promise((resolve) => {
        pending.set(id, { resolve, job: { position, index, hints, up } })
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
    if (mesh instanceof PhysicsMesh) mesh.disposeSkeleton()
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) (value as Texture).dispose()
    material.dispose()
  }
}
