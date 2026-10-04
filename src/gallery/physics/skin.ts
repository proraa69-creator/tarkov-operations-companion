/**
 * The boss model as a three.js SkinnedMesh driven by the secondary physics: the skin weights come from the rig and the
 * bone matrices straight from the simulation (BossPhysics.writeBones), not from a hierarchy of bone objects. Bone 0
 * is the body and is always the identity, so the body, head, arms, legs, weapons and rigid armour are drawn exactly
 * as modelled. Until a simulation is attached every vertex is on bone 0: the model is rigid. The bone texture is
 * uploaded only on frames where the simulation moved (`invalidate`).
 */
import {
  Box3, DetachedBindMode, Float32BufferAttribute, Matrix4, Skeleton, SkinnedMesh, Sphere, Uint16BufferAttribute, Vector3, Vector4,
  type Bone, type BufferAttribute, type BufferGeometry, type Material,
} from 'three'
import type { BossPhysics } from './sim'

const IDENTITY = new Matrix4().elements

/** A skeleton without bone objects: its matrices are written by the simulation. */
class PhysicsSkeleton extends Skeleton {
  physics: BossPhysics | null = null
  dirty = true

  constructor(count: number) {
    super(Array.from({ length: count }, () => null as unknown as Bone), Array.from({ length: count }, () => new Matrix4()))
  }

  override update() {
    if (!this.dirty) return
    this.dirty = false
    const target = this.boneMatrices as Float32Array
    if (this.physics) this.physics.writeBones(target)
    else for (let offset = 0; offset + 16 <= target.length; offset += 16) target.set(IDENTITY, offset)
    if (this.boneTexture) this.boneTexture.needsUpdate = true
  }
}

const index4 = new Vector4(), weight4 = new Vector4(), base = new Vector3(), moved = new Vector3(), matrix = new Matrix4()

export class PhysicsMesh extends SkinnedMesh {
  declare skeleton: PhysicsSkeleton
  /** How far the loose parts may move, mesh units: the bounds grow by it. */
  private margin = 0

  constructor(geometry: BufferGeometry, material: Material | Material[]) {
    super(geometry, material)
    const count = geometry.getAttribute('position').count
    const weights = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) weights[i * 4] = 1
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
    this.bindMode = DetachedBindMode
    this.bind(new PhysicsSkeleton(1), new Matrix4())
  }

  /** Drive the mesh by a simulation: its rig's skin weights, its bone matrices. */
  setPhysics(physics: BossPhysics) {
    const { rig } = physics
    const skinIndex = this.geometry.getAttribute('skinIndex') as BufferAttribute
    const skinWeight = this.geometry.getAttribute('skinWeight') as BufferAttribute
    ;(skinIndex.array as Uint16Array).set(rig.skinIndex.subarray(0, skinIndex.array.length))
    ;(skinWeight.array as Float32Array).set(rig.skinWeight.subarray(0, skinWeight.array.length))
    skinIndex.needsUpdate = true
    skinWeight.needsUpdate = true
    const skeleton = new PhysicsSkeleton(physics.boneCount)
    skeleton.physics = physics
    const previous = this.skeleton
    this.bind(skeleton, new Matrix4())
    previous.dispose()
    // the furthest a particle may go (max-distance envelope) plus a piece's swing, in mesh units
    this.margin = 0.4 / rig.scale
    this.computeBoundingBox()
    this.computeBoundingSphere()
  }

  /** The simulation moved: the bone matrices go to the GPU with the next frame. */
  invalidate() { this.skeleton.dirty = true }

  override computeBoundingBox() {
    const geometry = this.geometry
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    this.boundingBox = (this.boundingBox ?? new Box3()).copy(geometry.boundingBox!).expandByScalar(this.margin)
  }

  override computeBoundingSphere() {
    const geometry = this.geometry
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    this.boundingSphere = (this.boundingSphere ?? new Sphere()).copy(geometry.boundingSphere!)
    this.boundingSphere.radius += this.margin
  }

  /** Where a vertex is drawn now (raycasts, bounds): three.js's blend, with the simulation's matrices. */
  override applyBoneTransform(index: number, vector: Vector3): Vector3
  override applyBoneTransform(index: number, vector: Vector4): Vector4
  override applyBoneTransform(index: number, vector: Vector3 | Vector4): Vector3 | Vector4 {
    const matrices = this.skeleton.boneMatrices as Float32Array
    index4.fromBufferAttribute(this.geometry.getAttribute('skinIndex') as BufferAttribute, index)
    weight4.fromBufferAttribute(this.geometry.getAttribute('skinWeight') as BufferAttribute, index)
    base.set(vector.x, vector.y, vector.z)
    const sum = new Vector3()
    for (let c = 0; c < 4; c++) {
      const weight = weight4.getComponent(c)
      if (weight === 0) continue
      matrix.fromArray(matrices, index4.getComponent(c) * 16)
      sum.addScaledVector(moved.copy(base).applyMatrix4(matrix), weight)
    }
    vector.x = sum.x; vector.y = sum.y; vector.z = sum.z
    return vector
  }

  /** Frees the bone texture (the geometry and the material are freed with the model). */
  disposeSkeleton() { this.skeleton.dispose() }
}
