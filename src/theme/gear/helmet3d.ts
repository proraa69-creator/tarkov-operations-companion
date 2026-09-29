/**
 * The 3D mask by «Обзор» (see HelmetBadge): one of the GLB models in ./helmets, soft three-point lighting
 * (glass-visor and polished-metal variants add reflections and a low "sun" that glints as the mask turns),
 * idle sway / breathing and a turn toward the cursor, on top of the player's pose (nod, tilt, turn).
 *
 * One WebGL context for the badge's whole life: picking another mask swaps the model inside the same renderer
 * and disposes the old one (a second renderer on the same canvas would get the context the first one lost).
 * Frames are drawn on demand: at the display rate only while the head is still easing to a new pose or the
 * Knight's dreads are still swinging, otherwise at a slow idle rate for the breathing — and that only while the
 * window is focused and someone has used it in the last 15 s (none at all with reduced motion) — and never while
 * the page is hidden or the badge is off screen. Loaded with a dynamic import only while the mask is shown.
 */
import { AgXToneMapping, Box3, DirectionalLight, Group, HemisphereLight, MeshPhysicalMaterial, PMREMGenerator, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Texture, type WebGLRenderTarget } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { HelmetVariant } from './helmets'
import { REST_POSE, type HelmetAngles } from './helmetLayout'

/** The player's pose: degrees on top of the resting pose (+ = up / right, as the viewer sees it) and a size multiplier. */
export interface HelmetPose extends HelmetAngles { scale: number }

export interface HelmetHandle {
  /** Pointer relative to the mask's centre, roughly -1..1 each way; hover = the pointer is on the mask or on «Обзор». */
  setPointer(nx: number, ny: number, hover: boolean): void
  /** The player moved a slider: the head eases to the new pose about its own centre. */
  setPose(pose: HelmetPose): void
  /** Another mask: loaded into the same renderer; the current one stays until the new one is ready. */
  setVariant(variant: HelmetVariant): void
  setReduced(reduced: boolean): void
  /** The canvas size or the screen's pixel ratio changed. */
  resize(): void
  dispose(): void
}

export interface HelmetOptions {
  reduced: boolean
  pose: HelmetPose
  variant: HelmetVariant
  onReady?: (variant: HelmetVariant) => void
  onError?: (variant: HelmetVariant) => void
}

const DEG = Math.PI / 180
/** The model is scaled so its largest side is this many units: whole in view however it is turned. */
const MODEL_SIZE = 2.1
/** Supersampling for the small badge, capped: at most 1.5 canvas pixels per CSS pixel. */
const MAX_PIXEL_RATIO = 1.5
/** Frame rate of the slow idle breathing / sway; fast frames only while something is still moving. */
const IDLE_FPS = 10
/** The idle breathing stops this long after the last mouse / keyboard input (the head holds still until the next one). */
const IDLE_LINGER_MS = 15000
/** How fast the head eases to a new pose (1/s): about 1.5 s to settle. */
const EASE_RATE = 5
/** Below this (radians / scale) the head counts as settled. */
const SETTLED = 5e-4

const clampUnit = (value: number) => Math.max(-1, Math.min(1, value))

export function mountHelmet(canvas: HTMLCanvasElement, options: HelmetOptions): HelmetHandle {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true })
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.setClearColor(0x000000, 0)
  // Only when something changed (resizing the canvas clears it); true if it did.
  let fitted = ''
  const fit = () => {
    const ratio = Math.min(MAX_PIXEL_RATIO, (window.devicePixelRatio || 1) * 1.25)
    const width = canvas.clientWidth || 86, height = canvas.clientHeight || 86
    if (fitted === `${ratio} ${width} ${height}`) return false
    fitted = `${ratio} ${width} ${height}`
    renderer.setPixelRatio(ratio)
    renderer.setSize(width, height, false)
    return true
  }
  fit()

  const scene = new Scene()
  const camera = new PerspectiveCamera(26, 1, 0.1, 40)
  camera.position.set(0.3, 1.2, 6.6)
  camera.lookAt(0, 0, 0)

  // Lights: warm key from the top-left (same as the textures), cool rim from behind-right, soft sky fill.
  scene.add(new HemisphereLight(0xf2e8d0, 0x1d2016, 0.9))
  const key = new DirectionalLight(0xfff6ea, 2.6); key.position.set(-3, 4, 3.2); scene.add(key)
  const rim = new DirectionalLight(0xa9c2d8, 1.6); rim.position.set(3.5, 1.6, -3); scene.add(rim)
  const fill = new DirectionalLight(0xd9c79b, 0.4); fill.position.set(2.5, -1, 2.5); scene.add(fill)
  // Glass-visor and polished-metal masks also get reflections and a low front sun whose highlight slides across
  // them as the head turns; the others keep the plain three-point light they were tuned for.
  const sun = new DirectionalLight(0xfff2d6, 5); sun.position.set(-1.5, 2.5, 5); sun.visible = false; scene.add(sun)
  let environment: WebGLRenderTarget | null = null
  function setShiny(on: boolean) {
    if (on && !environment) {
      const pmrem = new PMREMGenerator(renderer)
      const room = new RoomEnvironment()
      environment = pmrem.fromScene(room, 0.04, 0.1, 100, { size: 128 })
      room.dispose()
      pmrem.dispose()
    } else if (!on && environment) {
      environment.dispose()
      environment = null
    }
    scene.environment = environment?.texture ?? null
    scene.environmentIntensity = 0.45
    sun.visible = on
  }

  // rig: the pose (rotation about the model's centre); holder: fits the model to MODEL_SIZE
  const rig = new Group()
  const holder = new Group()
  rig.add(holder)
  scene.add(rig)

  let disposed = false
  let reduced = options.reduced
  let pose: HelmetPose = { ...options.pose }
  let model: Object3D | null = null
  let shown: HelmetVariant | null = null
  let wanted: HelmetVariant = options.variant
  let loadId = 0
  const loader = new GLTFLoader()

  function load(variant: HelmetVariant) {
    wanted = variant
    const id = ++loadId
    loader.load(variant.url, (gltf) => {
      const next = gltf.scene
      if (disposed || id !== loadId) { release(next); return }
      const fitScale = prepare(next, variant, swing)
      if (model) { holder.remove(model); release(model) }
      model = next
      shown = variant
      holder.scale.setScalar(fitScale)
      holder.add(next)
      setShiny(!!(variant.glass || variant.shine))
      resetSway()
      options.onReady?.(variant)
      wake()
    }, undefined, () => {
      if (!disposed && id === loadId) options.onError?.(variant)
    })
  }

  // Eased pose (radians) and the pointer.
  let yaw = 0, pitch = 0, roll = 0, scale = 1
  let hover = false, nx = 0, ny = 0
  // Idle motion runs on its own clock, which stops while the window is in the background (no jump when it resumes).
  let idleTime = 0
  let focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
  let lastInput = performance.now()
  const idling = () => !reduced && focused && performance.now() - lastInput < IDLE_LINGER_MS
  // Hair swing: a springy lag that follows the mask's turning speed and overshoots when it stops.
  const swing = { lag: { value: new Vector3() }, time: { value: 0 } }
  const lagVelocity = new Vector3()
  const turnSpeed = new Vector3()
  const pull = new Vector3()
  const lastTurn = { yaw: 0, pitch: 0, roll: 0 }
  let swayPrimed = false
  function resetSway() { swing.lag.value.set(0, 0, 0); lagVelocity.set(0, 0, 0); swayPrimed = false }

  /** Moves the rig for this frame; true while something is still in motion (then the next frame follows at once). */
  function place(dt: number) {
    const animate = !reduced
    const idleOn = idling()
    if (idleOn) idleTime += dt
    const idle = animate ? Math.sin(idleTime * 0.45) * 0.14 : 0
    const breathe = animate ? 1 + Math.sin(idleTime * 1.7) * 0.012 : 1
    const follow = animate ? 1 : 0
    const target = {
      yaw: (REST_POSE.rotY + pose.yaw) * DEG + nx * (hover ? 0.6 : 0.22) * follow,
      pitch: (REST_POSE.rotX - pose.pitch) * DEG + ny * (hover ? 0.35 : 0.12) * follow,
      roll: (REST_POSE.rotZ - pose.roll) * DEG + (hover ? -nx * 0.08 : 0) * follow,
      scale: pose.scale * (hover && animate ? 1.06 : 1),
    }
    const k = animate ? 1 - Math.exp(-EASE_RATE * dt) : 1
    yaw += (target.yaw - yaw) * k; pitch += (target.pitch - pitch) * k; roll += (target.roll - roll) * k
    scale += (target.scale - scale) * k
    const easing = Math.abs(target.yaw - yaw) > SETTLED || Math.abs(target.pitch - pitch) > SETTLED
      || Math.abs(target.roll - roll) > SETTLED || Math.abs(target.scale - scale) > SETTLED
    const drawnYaw = yaw + idle
    // Euler 'YXZ': turn about the vertical axis, then nod about the ears' axis, then tilt about the nose — a head's
    // own axes, all through the model's centre, so it tilts and turns in place instead of orbiting.
    rig.rotation.set(pitch, drawnYaw, roll, 'YXZ')
    rig.scale.setScalar(scale * breathe)
    rig.position.y = animate ? Math.sin(idleTime * 1.7 + 0.6) * 0.012 : 0

    let swinging = false
    if (shown?.sway) {
      const lag = swing.lag.value
      if (!animate) {
        lag.set(0, 0, 0); lagVelocity.set(0, 0, 0)
      } else {
        // turning speed around the mask's own axes (x = nod, y = turn, z = tilt)
        if (swayPrimed && dt > 0) turnSpeed.set((pitch - lastTurn.pitch) / dt, (drawnYaw - lastTurn.yaw) / dt, (roll - lastTurn.roll) / dt)
        else turnSpeed.set(0, 0, 0)
        swayPrimed = true
        lastTurn.yaw = drawnYaw; lastTurn.pitch = pitch; lastTurn.roll = roll
        // underdamped spring toward the current turning speed (dreads trail, then swing back and settle),
        // integrated in steps of at most 1/60 s so the slow idle frames behave like fast ones
        const steps = Math.min(8, Math.max(1, Math.ceil(dt * 60)))
        const h = dt / steps
        for (let step = 0; step < steps; step++) {
          lagVelocity.addScaledVector(pull.copy(turnSpeed).sub(lag), 38 * h).multiplyScalar(Math.max(0, 1 - 3.2 * h))
          lag.addScaledVector(lagVelocity, h * 9)
        }
        lag.clampLength(0, 3)
        if (idleOn) swing.time.value = idleTime
        swinging = lagVelocity.length() > 0.01 || pull.copy(turnSpeed).sub(lag).length() > 0.01
      }
    }
    return easing || swinging
  }

  // ---------- frame scheduling ----------
  let raf = 0
  let timer = 0
  let lastFrame = 0
  let onScreen = true
  const canRender = () => !disposed && onScreen && !document.hidden && !!model

  function frame(now: number) {
    raf = 0
    const dt = lastFrame ? Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)) : 1 / 60
    lastFrame = now
    const busy = place(dt)
    renderer.render(scene, camera)
    if (!canRender()) { lastFrame = 0; return }
    if (busy) raf = requestAnimationFrame(frame)
    else if (idling()) timer = window.setTimeout(() => { timer = 0; if (!raf && canRender()) raf = requestAnimationFrame(frame) }, 1000 / IDLE_FPS)
    else lastFrame = 0 // settled and nothing idles: sleep until the next change
  }
  function wake() {
    if (!canRender()) return
    if (timer) { window.clearTimeout(timer); timer = 0 }
    if (!raf) raf = requestAnimationFrame(frame)
  }
  function halt() {
    if (raf) cancelAnimationFrame(raf)
    if (timer) window.clearTimeout(timer)
    raf = 0; timer = 0; lastFrame = 0
  }

  const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1]?.isIntersecting ?? onScreen
    if (onScreen) wake(); else halt()
  })
  io?.observe(canvas)
  const onVisibility = () => { if (document.hidden) halt(); else wake() }
  const onFocus = () => { focused = true; lastInput = performance.now(); wake() }
  const onBlur = () => { focused = false }
  // Any input brings the idle breathing back (only starts the loop if it was asleep: no extra frames while it runs).
  const onInput = () => { lastInput = performance.now(); if (!raf && !timer) wake() }
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(type, onInput, { passive: true, capture: true })
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  // also catches the pixel ratio changing when the window moves to another screen
  const onResize = () => { if (fit()) wake() }
  window.addEventListener('resize', onResize)

  load(options.variant)

  return {
    setPointer(x, y, h) {
      x = clampUnit(x); y = clampUnit(y)
      if (Math.abs(x - nx) < 1e-3 && Math.abs(y - ny) < 1e-3 && h === hover) return
      nx = x; ny = y; hover = h
      if (!reduced) wake()
    },
    setPose(next) {
      pose = { ...next }
      wake()
    },
    setVariant(variant) {
      if (variant.id === wanted.id && variant.url === wanted.url) return
      load(variant)
    },
    setReduced(next) {
      reduced = next
      wake()
    },
    resize() {
      onResize()
    },
    dispose() {
      if (disposed) return
      disposed = true
      halt()
      loadId++
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.removeEventListener(type, onInput, { capture: true })
      window.removeEventListener('resize', onResize)
      if (model) { holder.remove(model); release(model) }
      model = null
      environment?.dispose()
      environment = null
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

/** Per-variant material tweaks, then centres the model on the origin; returns the scale that fits it to MODEL_SIZE. */
function prepare(model: Object3D, variant: HelmetVariant, swing: { lag: { value: Vector3 }; time: { value: number } }) {
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    if (variant.glass) mesh.material = glassMaterial(mesh.material as MeshStandardMaterial)
    if (variant.sway && mesh.geometry.getAttribute('_sway')) addSway(mesh.material as MeshStandardMaterial, swing)
  })
  // Centre the model (the rig turns about this point) and fit it to MODEL_SIZE so any export scale works.
  const box = new Box3().setFromObject(model)
  const size = box.getSize(new Vector3())
  model.position.sub(box.getCenter(new Vector3()))
  return MODEL_SIZE / Math.max(size.x, size.y, size.z, 1e-6)
}

/** Frees a model's geometry, materials and textures (and the decoded images behind them). */
function release(root: Object3D) {
  const materials = new Set<Material>()
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
  })
  const textures = new Set<Texture>()
  for (const material of materials) {
    for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) textures.add(value as Texture)
    material.dispose()
  }
  for (const texture of textures) {
    texture.dispose()
    // GLTFLoader decodes to ImageBitmaps: free their pixels now instead of at some later garbage collection
    ;(texture.image as { close?: () => void } | null)?.close?.()
  }
}

/**
 * The same PBR maps on a physical material: the red channel of the roughness/metal map (255 on the visor)
 * drives a glossy clearcoat and a faint oil-film iridescence, so only the glass sparkles and shifts colour.
 */
function glassMaterial(source: MeshStandardMaterial) {
  const mask = source.roughnessMap
  const material = new MeshPhysicalMaterial({
    map: source.map, normalMap: source.normalMap, normalScale: source.normalScale,
    roughnessMap: source.roughnessMap, metalnessMap: source.metalnessMap, roughness: source.roughness, metalness: source.metalness,
    clearcoat: 1, clearcoatMap: mask, clearcoatRoughness: 0.03,
    iridescence: 0.7, iridescenceMap: mask, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520],
  })
  source.dispose()
  return material
}

/**
 * Bends vertices by their _sway weight (x: 0 at the roots → 1 at the tips, y: 1 on the forehead strings):
 * each point trails the turn (−lag × its offset from the crown), sags a little, and flutters gently.
 */
function addSway(material: MeshStandardMaterial, swing: { lag: { value: Vector3 }; time: { value: number } }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayLag = swing.lag
    shader.uniforms.uSwayTime = swing.time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 _sway;
uniform vec3 uSwayLag;
uniform float uSwayTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float w = _sway.x;
  float phase = dot(position, vec3(41.3, 17.9, 29.7));
  vec3 flutter = vec3(sin(uSwayTime * 2.3 + phase), 0.0, cos(uSwayTime * 1.9 + phase * 1.37));
  if (_sway.y > 0.5) {
    // loose strings across the forehead: a small wave that follows the turn
    float wave = sin(uSwayTime * 3.1 + position.x * 24.0);
    transformed += (vec3(-uSwayLag.y * 0.35, -abs(uSwayLag.y) * 0.25 + wave * 0.12, 0.0) + flutter * 0.25) * 0.02 * w;
  } else if (w > 0.0) {
    vec3 arm = position - vec3(0.0, 0.9, 0.0);
    vec3 trail = -cross(uSwayLag, arm);
    float lift = length(uSwayLag.xz) * 0.02;
    transformed += (trail * 0.07 + flutter * 0.006 * (1.0 + length(uSwayLag))) * w * w;
    transformed.y += lift * w * w;
  }
}`)
  }
  material.customProgramCacheKey = () => 'helmet-sway'
  material.needsUpdate = true
}
