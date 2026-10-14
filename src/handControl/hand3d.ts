import {
  BufferGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, HemisphereLight, Mesh,
  MeshStandardMaterial, OrthographicCamera, Quaternion, Scene, SphereGeometry, Vector3, WebGLRenderer,
} from 'three'
import { HAND_BONES, LM } from './types'

type P3 = { x: number; y: number; z: number }

/** Joint radius as a share of the palm span (finger widths taper towards the tips). */
const JOINT_RADIUS: number[] = (() => {
  const radii = new Array<number>(21).fill(0.1)
  radii[LM.WRIST] = 0.2
  ;[0.17, 0.15, 0.13, 0.11].forEach((r, i) => { radii[LM.THUMB_CMC + i] = r })
  const finger = [0.14, 0.12, 0.105, 0.095]
  ;[LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP].forEach((mcp, f) => {
    const k = f === 3 ? 0.85 : f === 2 ? 0.95 : 1
    finger.forEach((r, i) => { radii[mcp + i] = r * k })
  })
  return radii
})()

/** Palm outline (wrist → thumb base → knuckles) used for the thick palm plate. */
const PALM_RING = [LM.WRIST, LM.THUMB_CMC, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]
const PALM_THICKNESS = 0.24
const UP = new Vector3(0, 1, 0)

/**
 * Simple 3D hand bound to the 21-point skeleton: tapered cylinders for bones, spheres for joints
 * and a thick palm plate, lit softly in Raid OS brass. Rendered with an orthographic camera in
 * window pixels, only when a new hand frame arrives.
 */
export class Hand3D {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(0, 1, 0, -1, -4000, 4000)
  // Opaque parts (no overlap artefacts); the whole canvas is faded instead.
  private material = new MeshStandardMaterial({ color: 0xe2c48a, roughness: 0.55, metalness: 0.12, emissive: 0x2b2010, side: DoubleSide })
  private joints: Mesh[] = []
  private bones: Mesh[] = []
  private palm: Mesh
  private palmPositions = new Float32Array(PALM_RING.length * 2 * 3 + 2 * 3)
  private width = 0
  private height = 0
  private tmp = { a: new Vector3(), b: new Vector3(), dir: new Vector3(), q: new Quaternion() }

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
    this.renderer.setClearColor(0x000000, 0)
    this.camera.position.set(0, 0, 2000)
    this.scene.add(new HemisphereLight(0xfff2dc, 0x1a2219, 1.15))
    const key = new DirectionalLight(0xffffff, 1.5)
    key.position.set(-0.4, 0.8, 1)
    this.scene.add(key)

    const sphere = new SphereGeometry(1, 16, 12)
    for (let i = 0; i < 21; i++) {
      const joint = new Mesh(sphere, this.material)
      this.joints.push(joint)
      this.scene.add(joint)
    }
    for (const [a, b] of HAND_BONES) {
      // Unit-length cylinder along Y, base radius 1 at `a`, tapered towards `b`.
      const geometry = new CylinderGeometry(JOINT_RADIUS[b] / JOINT_RADIUS[a], 1, 1, 14, 1, true)
      const bone = new Mesh(geometry, this.material)
      this.bones.push(bone)
      this.scene.add(bone)
    }
    const palmGeometry = new BufferGeometry()
    palmGeometry.setAttribute('position', new Float32BufferAttribute(this.palmPositions, 3))
    palmGeometry.setIndex(palmIndices())
    this.palm = new Mesh(palmGeometry, this.material)
    this.scene.add(this.palm)
  }

  /** Draws the hand at window-pixel points (z positive towards the viewer); null clears. */
  render(points: P3[] | null, span: number, alpha: number, width: number, height: number) {
    if (width !== this.width || height !== this.height) {
      this.width = width
      this.height = height
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      this.renderer.setSize(width, height, false)
      this.camera.right = width
      this.camera.bottom = -height
      this.camera.updateProjectionMatrix()
    }
    const visible = Boolean(points) && alpha > 0.01
    this.scene.visible = visible
    this.canvas.style.opacity = String(visible ? 0.88 * alpha : 0)
    if (visible) this.place(points!, span)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.scene.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose()
    })
    this.material.dispose()
    this.renderer.dispose()
  }

  private place(points: P3[], span: number) {
    const v = (p: P3, out: Vector3) => out.set(p.x, -p.y, p.z)
    points.forEach((point, i) => {
      v(point, this.joints[i].position)
      this.joints[i].scale.setScalar(JOINT_RADIUS[i] * span)
    })
    const { a, b, dir, q } = this.tmp
    HAND_BONES.forEach(([from, to], i) => {
      v(points[from], a)
      v(points[to], b)
      dir.subVectors(b, a)
      const length = dir.length()
      const bone = this.bones[i]
      bone.visible = length > 0.5
      if (!bone.visible) return
      bone.position.addVectors(a, b).multiplyScalar(0.5)
      q.setFromUnitVectors(UP, dir.divideScalar(length))
      bone.quaternion.copy(q)
      const radius = JOINT_RADIUS[from] * span
      bone.scale.set(radius, length, radius)
    })
    this.placePalm(points.map((point) => v(point, new Vector3())), span)
  }

  /** Two copies of the palm outline offset along its normal, capped front and back. */
  private placePalm(points: Vector3[], span: number) {
    const ring = PALM_RING.map((index) => points[index])
    const center = ring.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(ring.length)
    const normal = new Vector3().subVectors(points[LM.INDEX_MCP], points[LM.WRIST])
      .cross(new Vector3().subVectors(points[LM.PINKY_MCP], points[LM.WRIST]))
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1)
    normal.normalize().multiplyScalar((PALM_THICKNESS * span) / 2)
    const out = this.palmPositions
    ring.forEach((p, i) => {
      out.set([p.x + normal.x, p.y + normal.y, p.z + normal.z], i * 3)
      out.set([p.x - normal.x, p.y - normal.y, p.z - normal.z], (ring.length + i) * 3)
    })
    const centers = ring.length * 2 * 3
    out.set([center.x + normal.x, center.y + normal.y, center.z + normal.z], centers)
    out.set([center.x - normal.x, center.y - normal.y, center.z - normal.z], centers + 3)
    const geometry = this.palm.geometry
    geometry.attributes.position.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
  }
}

function palmIndices() {
  const n = PALM_RING.length
  const front = 2 * n
  const back = 2 * n + 1
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    indices.push(front, i, j)
    indices.push(back, n + j, n + i)
    indices.push(i, n + i, j, j, n + i, n + j)
  }
  return indices
}
