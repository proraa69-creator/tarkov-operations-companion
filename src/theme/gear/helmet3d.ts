/**
 * A small, original high-cut tactical helmet built procedurally in three.js for the Gear theme's sidebar:
 * shell with a camo cover, rubber edge trim, side rails, velcro loop fields, NVG shroud with bungees,
 * rear counterweight pouch and rail-mounted ear-pro cups. Soft three-point lighting, idle sway/breathing,
 * and it turns toward the cursor. Loaded with a dynamic import only while the theme is active.
 */
import {
  AgXToneMapping, BufferGeometry, CanvasTexture, CatmullRomCurve3, CylinderGeometry, DirectionalLight,
  DoubleSide, Float32BufferAttribute, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera,
  RepeatWrapping, SRGBColorSpace, Scene, TextureLoader, TorusGeometry, TubeGeometry, Vector3, WebGLRenderer,
  type Material, type Texture,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import coverUrl from '../../assets/gear/cordura-multicam.webp'

export interface HelmetHandle {
  /** Pointer relative to the helmet centre, roughly -1..1 each way; hover = the Overview item is hovered. */
  setPointer(nx: number, ny: number, hover: boolean): void
  dispose(): void
}

// Shell: an ellipsoid cap. θ = 0 faces forward (+z); t = 0..1 runs from the crown to the cut line.
const RX = 1, RY = 1.02, RZ = 1.12
/** High cut: the edge rises over the ears, drops at the back and sits at the brow in front. */
const cutPhi = (theta: number) => 1.44 - 0.16 * Math.cos(theta) + 0.19 * Math.cos(2 * theta)
function shellPoint(theta: number, t: number, lift = 0) {
  const phi = t * cutPhi(theta)
  const s = Math.sin(phi)
  const p = new Vector3(RX * s * Math.sin(theta), RY * Math.cos(phi), RZ * s * Math.cos(theta))
  if (lift) p.add(shellNormal(p).multiplyScalar(lift))
  return p
}
function shellNormal(p: Vector3) {
  return new Vector3(p.x / (RX * RX), p.y / (RY * RY), p.z / (RZ * RZ)).normalize()
}

/** A patch of the shell surface (θ0..θ1, t0..t1), lifted off the shell, with analytic normals and UVs. */
function shellPatch(theta0: number, theta1: number, t0: number, t1: number, lift: number, segU = 64, segV = 20, uvScale = 0.75) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  for (let v = 0; v <= segV; v++) {
    for (let u = 0; u <= segU; u++) {
      const theta = theta0 + ((theta1 - theta0) * u) / segU
      const t = Math.max(1e-4, t0 + ((t1 - t0) * v) / segV)
      const p = shellPoint(theta, t, lift)
      const n = shellNormal(p)
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z)
      uv.push((theta / (Math.PI * 2)) * uvScale, (t * cutPhi(theta) * uvScale) / (Math.PI * 2) * 1.05)
    }
  }
  for (let v = 0; v < segV; v++) for (let u = 0; u < segU; u++) {
    const a = v * (segU + 1) + u, b = a + 1, c = a + segU + 1, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** Tiny procedural loop-fabric texture for the velcro fields (cheap, generated once). */
function loopTexture(hex: string) {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = hex; g.fillRect(0, 0, 128, 128)
  let s = 7
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,240,.10)' : 'rgba(0,0,0,.22)'
    g.fillRect(r() * 128, r() * 128, 1 + r() * 1.5, 1 + r() * 1.5)
  }
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = SRGBColorSpace
  return t
}

/** Places an object on the shell at (θ, t), facing out along the surface normal. */
function onShell(obj: Group | Mesh, theta: number, t: number, lift: number) {
  const p = shellPoint(theta, t, lift)
  obj.position.copy(p)
  obj.lookAt(p.clone().add(shellNormal(p)))
}

export function mountHelmet(canvas: HTMLCanvasElement, options: { reduced: boolean }): HelmetHandle {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * 1.25)
  renderer.setSize(canvas.clientWidth || 76, canvas.clientHeight || 76, false)
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.28
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(26, 1, 0.1, 40)
  camera.position.set(0.3, 1.5, 6.6)
  camera.lookAt(0, 0.2, 0)

  // Lights: warm key from the top-left (same as the textures), cool rim from behind-right, soft sky fill.
  scene.add(new HemisphereLight(0xf2e8d0, 0x1d2016, 0.85))
  const key = new DirectionalLight(0xfff6ea, 2.6); key.position.set(-3, 4, 3.2); scene.add(key)
  const rim = new DirectionalLight(0xa9c2d8, 1.6); rim.position.set(3.5, 1.6, -3); scene.add(rim)
  const fill = new DirectionalLight(0xd9c79b, 0.35); fill.position.set(2.5, -1, 2.5); scene.add(fill)

  const textures: Texture[] = []
  const materials: Material[] = []
  const mat = (m: MeshStandardMaterial) => { materials.push(m); return m }

  const cover = new TextureLoader().load(coverUrl, () => { if (!running) render() })
  cover.wrapS = cover.wrapT = RepeatWrapping; cover.colorSpace = SRGBColorSpace; cover.anisotropy = 4
  textures.push(cover)
  const coverMat = mat(new MeshStandardMaterial({ map: cover, color: 0xc6c0ac, roughness: 0.93, metalness: 0, side: DoubleSide }))
  const rubber = mat(new MeshStandardMaterial({ color: 0x151613, roughness: 0.75 }))
  const polymer = mat(new MeshStandardMaterial({ color: 0x1e201c, roughness: 0.55, metalness: 0.1 }))
  const metal = mat(new MeshStandardMaterial({ color: 0x3a3c38, roughness: 0.38, metalness: 0.75 }))
  const greenLoop = loopTexture('#3d4331'); textures.push(greenLoop)
  const tanLoop = loopTexture('#76634a'); textures.push(tanLoop)
  const loopGreen = mat(new MeshStandardMaterial({ map: greenLoop, roughness: 1 }))
  const loopTan = mat(new MeshStandardMaterial({ map: tanLoop, roughness: 1 }))
  const cupMat = mat(new MeshStandardMaterial({ color: 0x57583f, roughness: 0.6, metalness: 0.05 }))
  const bungee = mat(new MeshStandardMaterial({ color: 0x2a2620, roughness: 0.8 }))

  const helmet = new Group()
  const add = (m: Mesh) => { helmet.add(m); return m }

  // Shell with cover, plus a slightly smaller dark liner so the inside never shows as a hole.
  add(new Mesh(shellPatch(0, Math.PI * 2, 0, 1, 0, 96, 28), coverMat))
  add(new Mesh(shellPatch(0, Math.PI * 2, 0, 1, -0.05, 64, 16), mat(new MeshStandardMaterial({ color: 0x0f100d, roughness: 1, side: DoubleSide }))))
  // Rubber edge trim along the cut line.
  const rimPts: Vector3[] = []
  for (let i = 0; i < 128; i++) rimPts.push(shellPoint((i / 128) * Math.PI * 2, 1, -0.012))
  add(new Mesh(new TubeGeometry(new CatmullRomCurve3(rimPts, true), 160, 0.04, 8, true), rubber))
  // Velcro: crown field and fields above each rail.
  add(new Mesh(shellPatch(0, Math.PI * 2, 0, 0.24, 0.014, 48, 4), loopGreen))
  add(new Mesh(shellPatch(-0.3, 0.3, 0.46, 0.7, 0.014, 12, 6), loopGreen))
  add(new Mesh(shellPatch(Math.PI - 0.34, Math.PI + 0.34, 0.34, 0.5, 0.014, 12, 5), loopGreen))
  for (const side of [1, -1]) {
    const a = side > 0 ? Math.PI * 0.3 : Math.PI * 1.44, b = side > 0 ? Math.PI * 0.56 : Math.PI * 1.7
    add(new Mesh(shellPatch(a, b, 0.6, 0.78, 0.014, 20, 6), loopTan))
  }
  // Rear velcro field behind the counterweight.
  

  // Side rails with bolts and ear-pro cups.
  for (const side of [1, -1]) {
    const pts: Vector3[] = []
    for (let i = 0; i <= 24; i++) {
      const th = side * (Math.PI * 0.22 + (Math.PI * 0.56 * i) / 24)
      pts.push(shellPoint(th, 0.88, 0.04))
    }
    const rail = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.05, 6, false), polymer)
    add(rail)
    for (const f of [0.25, 0.5, 0.75]) {
      const bolt = new Mesh(new CylinderGeometry(0.035, 0.035, 0.05, 10), metal)
      onShell(bolt, side * (Math.PI * 0.22 + Math.PI * 0.56 * f), 0.88, 0.09)
      bolt.rotateX(Math.PI / 2)
      add(bolt)
    }
    // ear cup on an arm hanging from the rail
    const cup = new Group()
    const shell = new Mesh(new CylinderGeometry(0.3, 0.33, 0.2, 28), cupMat)
    shell.rotation.z = Math.PI / 2
    cup.add(shell)
    const cap = new Mesh(new CylinderGeometry(0.2, 0.26, 0.06, 24), cupMat)
    cap.rotation.z = Math.PI / 2; cap.position.x = side * 0.12
    cup.add(cap)
    const knob = new Mesh(new CylinderGeometry(0.06, 0.06, 0.06, 12), polymer)
    knob.rotation.z = Math.PI / 2; knob.position.set(side * 0.16, -0.12, 0.08)
    cup.add(knob)
    const cushion = new Mesh(new TorusGeometry(0.24, 0.06, 10, 28), rubber)
    cushion.rotation.y = Math.PI / 2; cushion.position.x = -side * 0.1
    cup.add(cushion)
    const arm = new Mesh(new RoundedBoxGeometry(0.07, 0.42, 0.13, 2, 0.02), polymer)
    arm.position.set(-side * 0.02, 0.38, 0)
    cup.add(arm)
    const rp = shellPoint(side * Math.PI * 0.5, 0.88, 0.1)
    cup.position.set(rp.x + side * 0.1, rp.y - 0.52, rp.z - 0.02)
    cup.rotation.z = side * 0.1
    helmet.add(cup)
  }

  // NVG shroud at the brow with bungee retention running back to the rails.
  const shroud = new Group()
  const plate = new Mesh(new RoundedBoxGeometry(0.42, 0.26, 0.07, 3, 0.03), metal)
  shroud.add(plate)
  const slot = new Mesh(new RoundedBoxGeometry(0.2, 0.12, 0.04, 2, 0.015), mat(new MeshStandardMaterial({ color: 0x0b0b0a, roughness: 0.9 })))
  slot.position.set(0, -0.03, 0.035)
  shroud.add(slot)
  for (const x of [-0.15, 0.15]) {
    const screw = new Mesh(new CylinderGeometry(0.025, 0.025, 0.03, 10), metal)
    screw.rotation.x = Math.PI / 2; screw.position.set(x, 0.07, 0.04)
    shroud.add(screw)
  }
  onShell(shroud, 0, 0.86, 0.035)
  helmet.add(shroud)
  for (const side of [1, -1]) {
    const a = shellPoint(side * 0.2, 0.84, 0.06), m = shellPoint(side * 0.45, 0.8, 0.06), b = shellPoint(side * Math.PI * 0.24, 0.88, 0.06)
    add(new Mesh(new TubeGeometry(new CatmullRomCurve3([a, m, b]), 16, 0.022, 6, false), bungee))
  }

  // Counterweight pouch at the back, in the same camo, with a flap line and a pull tab.
  const pouch = new Group()
  const body = new Mesh(new RoundedBoxGeometry(0.56, 0.36, 0.17, 3, 0.05), coverMat)
  pouch.add(body)
  const flap = new Mesh(new RoundedBoxGeometry(0.58, 0.12, 0.19, 2, 0.04), coverMat)
  flap.position.y = 0.13
  pouch.add(flap)
  const tab = new Mesh(new RoundedBoxGeometry(0.08, 0.1, 0.02, 1, 0.008), bungee)
  tab.position.set(0, 0.05, 0.1)
  pouch.add(tab)
  onShell(pouch, Math.PI, 0.74, 0.08)
  helmet.add(pouch)

  // Presentation: tilted, three-quarter view.
  helmet.position.y = -0.05
  const rig = new Group()
  rig.add(helmet)
  scene.add(rig)

  let yaw = -0.62, pitch = 0.18, roll = -0.14
  let target = { yaw, pitch, roll, scale: 1 }
  let scale = 1
  let hover = false, nx = 0, ny = 0
  let raf = 0
  let running = !options.reduced
  const start = performance.now()

  function render() {
    renderer.render(scene, camera)
  }
  function pose(time: number) {
    const idle = options.reduced ? 0 : Math.sin(time * 0.45) * 0.2
    const breathe = options.reduced ? 1 : 1 + Math.sin(time * 1.7) * 0.012
    target = {
      yaw: -0.62 + idle + nx * (hover ? 0.75 : 0.28),
      pitch: 0.18 + ny * (hover ? 0.4 : 0.14),
      roll: -0.14 + (hover ? -nx * 0.1 : 0),
      scale: hover ? 1.07 : 1,
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
    pose((now - start) / 1000)
    render()
    if (running) raf = requestAnimationFrame(frame)
  }
  // Only animate while on screen.
  const io = new IntersectionObserver(([entry]) => {
    running = !options.reduced && !!entry?.isIntersecting
    if (running && !raf) raf = requestAnimationFrame(frame)
  })
  io.observe(canvas)
  pose(0); render()
  if (running) raf = requestAnimationFrame(frame)

  return {
    setPointer(x, y, h) {
      nx = Math.max(-1, Math.min(1, x)); ny = Math.max(-1, Math.min(1, y)); hover = h
      if (!running && !raf) raf = requestAnimationFrame(frame)
    },
    dispose() {
      running = false
      cancelAnimationFrame(raf)
      io.disconnect()
      scene.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose() })
      materials.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
