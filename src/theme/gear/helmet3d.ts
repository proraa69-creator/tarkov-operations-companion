/**
 * The Gear theme's 3D helmet: one of the GLB models in ./helmets, soft three-point lighting plus a small
 * room environment for reflections, a low "sun" that glints off the visor glass as the helmet turns, idle
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
  // Low front sun: its highlight slides across the glossy visor as the helmet follows the cursor.
  const sun = new DirectionalLight(0xfff2d6, 5); sun.position.set(-1.5, 2.5, 5); scene.add(sun)
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = environment
  scene.environmentIntensity = 0.45

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

  const pose = options.pose
  let yaw = 0, pitch = 0, roll = 0, scale = 1
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
      environment.dispose()
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
