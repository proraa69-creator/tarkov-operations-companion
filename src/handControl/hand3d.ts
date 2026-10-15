import {
  type Bone, DirectionalLight, HemisphereLight, Matrix4, Mesh, MeshStandardMaterial, type Object3D, OrthographicCamera, Quaternion, Scene,
  Vector3, WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
// WebXR Input Profiles "generic-hand" (MIT, see assets/LICENSE-webxr-input-profiles.md): a clean
// skinned hand with one bone per joint, named by the WebXR hand joint names.
import leftHandUrl from './assets/generic-hand-left.glb?url'
import rightHandUrl from './assets/generic-hand-right.glb?url'
import { GHOST_PALM_PX } from './ghostPose'
import { LM } from './types'

type P3 = { x: number; y: number; z: number }

/** Which hand the drawn shape is (a mirrored view of a right hand looks like a left hand). */
export type Chirality = 'left' | 'right'

export interface DrawnHand {
  /** 21 points in window pixels, z positive towards the viewer */
  points: P3[]
  chirality: Chirality
}

type Joint = { name: string; at: number | ((p: Vector3[]) => Vector3); aim: number | ((p: Vector3[]) => Vector3) }

const FINGERS = [
  { name: 'index-finger', mcp: LM.INDEX_MCP },
  { name: 'middle-finger', mcp: LM.MIDDLE_MCP },
  { name: 'ring-finger', mcp: LM.RING_MCP },
  { name: 'pinky-finger', mcp: LM.PINKY_MCP },
] as const

/** Past the tip: the tip joint looks the same way as the last phalanx. */
const beyond = (from: number, to: number) => (p: Vector3[]) => p[to].clone().multiplyScalar(2).sub(p[from])

/**
 * MediaPipe's 21 landmarks → the 25 WebXR joints. The finger metacarpals have no landmark: they
 * sit on the wrist→knuckle line at the model's own ratio (`metacarpalAt`, measured on load).
 */
function jointMap(metacarpalAt: Record<string, number>): Joint[] {
  const joints: Joint[] = [
    { name: 'wrist', at: LM.WRIST, aim: LM.MIDDLE_MCP },
    { name: 'thumb-metacarpal', at: LM.THUMB_CMC, aim: LM.THUMB_MCP },
    { name: 'thumb-phalanx-proximal', at: LM.THUMB_MCP, aim: LM.THUMB_IP },
    { name: 'thumb-phalanx-distal', at: LM.THUMB_IP, aim: LM.THUMB_TIP },
    { name: 'thumb-tip', at: LM.THUMB_TIP, aim: beyond(LM.THUMB_IP, LM.THUMB_TIP) },
  ]
  for (const { name, mcp } of FINGERS) {
    const k = metacarpalAt[name] ?? 0.35
    joints.push(
      { name: `${name}-metacarpal`, at: (p) => p[LM.WRIST].clone().lerp(p[mcp], k), aim: mcp },
      { name: `${name}-phalanx-proximal`, at: mcp, aim: mcp + 1 },
      { name: `${name}-phalanx-intermediate`, at: mcp + 1, aim: mcp + 2 },
      { name: `${name}-phalanx-distal`, at: mcp + 2, aim: mcp + 3 },
      { name: `${name}-tip`, at: mcp + 3, aim: beyond(mcp + 2, mcp + 3) },
    )
  }
  return joints
}

const pick = (spec: Joint['at'], points: Vector3[]) => (typeof spec === 'number' ? points[spec] : spec(points))

interface HandModel {
  root: Object3D
  bones: Map<string, Bone>
  joints: Joint[]
  /** model units (metres) → window pixels, so the model palm matches GHOST_PALM_PX */
  scale: number
}

/**
 * The drawn 3D hand: a skinned hand model whose bones follow the 21-point skeleton. Rendered with
 * an orthographic camera in window pixels, only when a new hand frame arrives. Up to two hands.
 */
export class Hand3D {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(0, 1, 0, -1, -4000, 4000)
  private material = new MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.62, metalness: 0.02, emissive: 0x1d140c })
  private templates: Record<Chirality, Object3D> | null = null
  private pool: Record<Chirality, HandModel[]> = { left: [], right: [] }
  private width = 0
  private height = 0
  private tmp = { x: new Vector3(), y: new Vector3(), z: new Vector3(), m: new Matrix4(), q: new Quaternion() }

  private constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
    this.renderer.setClearColor(0x000000, 0)
    this.camera.position.set(0, 0, 2000)
    this.scene.add(new HemisphereLight(0xfff2e6, 0x20251f, 1.25))
    const key = new DirectionalLight(0xffffff, 1.6)
    key.position.set(-0.4, 0.8, 1)
    this.scene.add(key)
  }

  /** Loads the bundled models; rejects (and the outline is drawn instead) if WebGL or loading fails. */
  static async create(canvas: HTMLCanvasElement) {
    const hand = new Hand3D(canvas)
    try {
      const loader = new GLTFLoader()
      const [left, right] = await Promise.all([loader.loadAsync(leftHandUrl), loader.loadAsync(rightHandUrl)])
      hand.templates = { left: left.scene, right: right.scene }
      return hand
    } catch (error) {
      hand.dispose()
      throw error
    }
  }

  /** Draws the given hands (window pixels); an empty list clears. `alpha` fades the whole layer. */
  render(hands: DrawnHand[], alpha: number, width: number, height: number) {
    if (width !== this.width || height !== this.height) {
      this.width = width
      this.height = height
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      this.renderer.setSize(width, height, false)
      this.camera.right = width
      this.camera.bottom = -height
      this.camera.updateProjectionMatrix()
    }
    const visible = hands.length > 0 && alpha > 0.01
    this.canvas.style.opacity = String(visible ? 0.92 * alpha : 0)
    const used: Record<Chirality, number> = { left: 0, right: 0 }
    if (visible) {
      for (const hand of hands) {
        const model = this.model(hand.chirality, used[hand.chirality]++)
        if (model) this.pose(model, hand)
      }
    }
    for (const chirality of ['left', 'right'] as const) {
      this.pool[chirality].forEach((model, index) => { model.root.visible = visible && index < used[chirality] })
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.scene.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose()
    })
    this.material.dispose()
    this.renderer.dispose()
  }

  private model(chirality: Chirality, index: number): HandModel | null {
    const pool = this.pool[chirality]
    if (pool[index]) return pool[index]
    if (!this.templates) return null
    const root = cloneSkinned(this.templates[chirality])
    const bones = new Map<string, Bone>()
    root.traverse((object) => {
      if ((object as Bone).isBone) bones.set(object.name, object as Bone)
      if (object instanceof Mesh) {
        object.material = this.material
        // Bones move far from the bind pose: never cull the mesh by its rest bounds.
        object.frustumCulled = false
      }
    })
    const rest = (name: string) => bones.get(name)?.position ?? new Vector3()
    const wrist = rest('wrist')
    const metacarpalAt: Record<string, number> = {}
    for (const { name } of FINGERS) {
      const knuckle = rest(`${name}-phalanx-proximal`)
      metacarpalAt[name] = rest(`${name}-metacarpal`).distanceTo(wrist) / Math.max(1e-6, knuckle.distanceTo(wrist))
    }
    // Same rotation-robust palm span as the tracked hand (imageSpan): the two palms match in size.
    const span = Math.max(
      wrist.distanceTo(rest('middle-finger-phalanx-proximal')),
      wrist.distanceTo(rest('index-finger-phalanx-proximal')),
      wrist.distanceTo(rest('pinky-finger-phalanx-proximal')),
      rest('index-finger-phalanx-proximal').distanceTo(rest('pinky-finger-phalanx-proximal')) * 1.3,
    )
    const model: HandModel = { root, bones, joints: jointMap(metacarpalAt), scale: GHOST_PALM_PX / Math.max(1e-6, span) }
    root.scale.setScalar(model.scale)
    this.scene.add(root)
    pool[index] = model
    return model
  }

  /**
   * Every bone gets its absolute place in the hand (the model's skeleton is flat, like WebXR
   * joints): positioned on its landmark, −Z pointing to the next joint, −Y out of the palm.
   */
  private pose(model: HandModel, hand: DrawnHand) {
    const points = hand.points.map((p) => new Vector3(p.x, -p.y, p.z).divideScalar(model.scale))
    const finger = new Vector3().subVectors(points[LM.MIDDLE_MCP], points[LM.WRIST]).normalize()
    const across = new Vector3().subVectors(points[LM.INDEX_MCP], points[LM.PINKY_MCP]).normalize()
    // finger × thumb-side is the back of a right hand and the palm of a left hand (model rest pose:
    // right palm faces −X, left +X, fingers −Y, thumb side −Z). Turning the hand over flips the
    // thumb side in the image, so the palm direction follows.
    const palm = new Vector3().crossVectors(finger, across)
    if (hand.chirality === 'right') palm.negate()
    const { x, y, z, m, q } = this.tmp
    for (const joint of model.joints) {
      const bone = model.bones.get(joint.name)
      if (!bone) continue
      const at = pick(joint.at, points)
      bone.position.copy(at)
      z.subVectors(at, pick(joint.aim, points))
      if (z.lengthSq() < 1e-12) continue
      z.normalize()
      y.copy(palm).negate().addScaledVector(z, -palm.clone().negate().dot(z))
      if (y.lengthSq() < 1e-8) continue
      y.normalize()
      x.crossVectors(y, z)
      q.setFromRotationMatrix(m.makeBasis(x, y, z))
      bone.quaternion.copy(q)
    }
  }
}
