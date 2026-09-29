/**
 * The Gear theme's 3D helmet: one of the GLB models in ./helmets, soft three-point lighting (glass-visor
 * variants add reflections and a low "sun" that glints off the visor as the helmet turns), idle
 * sway/breathing and a turn toward the cursor. The saved pose (see HelmetBadge) sits under the idle motion.
 * Loaded with a dynamic import only while the theme is active.
 */
import { AgXToneMapping, Box3, DirectionalLight, Group, HemisphereLight, Mesh, MeshPhysicalMaterial, PMREMGenerator, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Material, type MeshStandardMaterial, type Object3D, type Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { HelmetVariant } from './helmets'

/** Rotation in degrees and a size multiplier set by the player. */
export interface HelmetPose { rotX: number; rotY: number; rotZ: number; scale: number }

export interface HelmetHandle {
  /** Pointer relative to the helmet centre, roughly -1..1 each way; hover = the Overview item is hovered. */
  setPointer(nx: number, ny: number, hover: boolean): void
  /** The player changed the saved pose (e.g. the tilt slider); the helmet eases to it without remounting. */
  setPose(pose: HelmetPose): void
  /** Canvas pixel size changed (the badge was resized). */
  resize(): void
  dispose(): void
}

const DEG = Math.PI / 180
/** The model is scaled so its largest side is this many units, which the camera frames comfortably. */
const MODEL_SIZE = 2.1

export function mountHelmet(canvas: HTMLCanvasElement, options: { reduced: boolean; pose: HelmetPose; variant: HelmetVariant; onReady?: () => void; onError?: () => void }): HelmetHandle {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * 1.25)
  renderer.setSize(canvas.clientWidth || 86, canvas.clientHeight || 86, false)
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(26, 1, 0.1, 40)
  camera.position.set(0.3, 1.2, 6.6)
  camera.lookAt(0, 0, 0)

  // Lights: warm key from the top-left (same as the textures), cool rim from behind-right, soft sky fill.
  scene.add(new HemisphereLight(0xf2e8d0, 0x1d2016, 0.9))
  const key = new DirectionalLight(0xfff6ea, 2.6); key.position.set(-3, 4, 3.2); scene.add(key)
  const rim = new DirectionalLight(0xa9c2d8, 1.6); rim.position.set(3.5, 1.6, -3); scene.add(rim)
  const fill = new DirectionalLight(0xd9c79b, 0.4); fill.position.set(2.5, -1, 2.5); scene.add(fill)
  // Glass-visor and polished-metal helmets get reflections and a low front sun whose highlight slides across the visor as the
  // helmet follows the cursor; the original model keeps the plain three-point light it was tuned for.
  let environment: Texture | null = null
  if (options.variant.glass || options.variant.shine) {
    const sun = new DirectionalLight(0xfff2d6, 5); sun.position.set(-1.5, 2.5, 5); scene.add(sun)
    const pmrem = new PMREMGenerator(renderer)
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.environment = environment
    scene.environmentIntensity = 0.45
  }

  const rig = new Group()
  const holder = new Group()
  rig.add(holder)
  scene.add(rig)

  let disposed = false
  new GLTFLoader().load(options.variant.url, (gltf) => {
    if (disposed) { release(gltf.scene); return }
    const model = gltf.scene
    if (options.variant.glass) model.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.isMesh) mesh.material = glassMaterial(mesh.material as MeshStandardMaterial)
    })
    if (options.variant.sway) model.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.isMesh && mesh.geometry.getAttribute('_sway')) addSway(mesh.material as MeshStandardMaterial, swing)
    })
    // Centre the model and fit it to MODEL_SIZE so any export scale works.
    const box = new Box3().setFromObject(model)
    const size = box.getSize(new Vector3())
    const centre = box.getCenter(new Vector3())
    model.position.sub(centre)
    holder.scale.setScalar(MODEL_SIZE / Math.max(size.x, size.y, size.z, 1e-6))
    holder.add(model)
    options.onReady?.()
    wake()
  }, undefined, () => options.onError?.())

  let pose: HelmetPose = { ...options.pose }
  let yaw = 0, pitch = 0, roll = 0, scale = 1
  // Hair swing: a springy lag that follows the mask's turning speed and overshoots when it stops.
  const swing = { lag: { value: new Vector3() }, time: { value: 0 } }
  const lagVelocity = new Vector3()
  let lastTurn = { yaw: 0, pitch: 0, roll: 0, at: 0 }
  let hover = false, nx = 0, ny = 0
  let raf = 0
  let running = !options.reduced
  const start = performance.now()

  function place(time: number) {
    const idle = options.reduced ? 0 : Math.sin(time * 0.45) * 0.14
    const breathe = options.reduced ? 1 : 1 + Math.sin(time * 1.7) * 0.012
    const target = {
      yaw: pose.rotY * DEG + idle + nx * (hover ? 0.6 : 0.22),
      pitch: pose.rotX * DEG + ny * (hover ? 0.35 : 0.12),
      roll: pose.rotZ * DEG + (hover ? -nx * 0.08 : 0),
      scale: pose.scale * (hover ? 1.06 : 1),
    }
    const k = options.reduced ? 1 : 0.08
    yaw += (target.yaw - yaw) * k; pitch += (target.pitch - pitch) * k; roll += (target.roll - roll) * k
    scale += (target.scale - scale) * k
    rig.rotation.set(pitch, yaw, roll, 'YXZ')
    rig.scale.setScalar(scale * breathe)
    rig.position.y = options.reduced ? 0 : Math.sin(time * 1.7 + 0.6) * 0.012
    if (options.variant.sway && !options.reduced) {
      const dt = Math.min(0.05, Math.max(0.001, time - lastTurn.at))
      // turning speed around the mask's own axes (x = nod, y = turn, z = tilt)
      const speed = new Vector3((pitch - lastTurn.pitch) / dt, (yaw - lastTurn.yaw) / dt, (roll - lastTurn.roll) / dt)
      lastTurn = { yaw, pitch, roll, at: time }
      const lag = swing.lag.value
      // underdamped spring toward the current turning speed: dreads trail, then swing back and settle
      lagVelocity.addScaledVector(speed.sub(lag), 38 * dt).multiplyScalar(Math.max(0, 1 - 3.2 * dt))
      lag.addScaledVector(lagVelocity, dt * 9)
      lag.clampLength(0, 3)
      swing.time.value = time
    }
  }
  function frame(now: number) {
    raf = 0
    place((now - start) / 1000)
    renderer.render(scene, camera)
    if (running) raf = requestAnimationFrame(frame)
  }
  function wake() { if (!raf) raf = requestAnimationFrame(frame) }
  // Only animate while on screen.
  const io = new IntersectionObserver(([entry]) => {
    running = !options.reduced && !!entry?.isIntersecting
    if (running) wake()
  })
  io.observe(canvas)
  wake()

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

  return {
    setPointer(x, y, h) {
      nx = Math.max(-1, Math.min(1, x)); ny = Math.max(-1, Math.min(1, y)); hover = h
      wake()
    },
    setPose(next) {
      pose = { ...next }
      wake()
    },
    resize() {
      renderer.setSize(canvas.clientWidth || 86, canvas.clientHeight || 86, false)
      wake()
    },
    dispose() {
      disposed = true
      running = false
      cancelAnimationFrame(raf)
      io.disconnect()
      release(scene)
      environment?.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
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
