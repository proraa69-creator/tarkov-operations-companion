// Minimal GLB reader for the Tripo boss exports (one mesh, one primitive, no Draco): positions and indices.
import { readFileSync } from 'node:fs'

export interface GlbMesh { position: Float32Array; index: Uint32Array | Uint16Array | null; normal: Float32Array | null }

export function readGlbMesh(file: string): GlbMesh {
  const buf = readFileSync(file)
  const jsonLength = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'))
  const binStart = 20 + jsonLength + 8
  const bin = buf.subarray(binStart)
  const prim = gltf.meshes[0].primitives[0]
  const read = (accessorIndex: number) => {
    const accessor = gltf.accessors[accessorIndex]
    const view = gltf.bufferViews[accessor.bufferView]
    if (view.byteStride) throw new Error('interleaved buffers are not supported')
    const comps = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[accessor.type]
    const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const count = accessor.count * comps
    const slice = bin.buffer.slice(start, start + count * (accessor.componentType === 5126 || accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1))
    if (accessor.componentType === 5126) return new Float32Array(slice)
    if (accessor.componentType === 5125) return new Uint32Array(slice)
    if (accessor.componentType === 5123) return new Uint16Array(slice)
    throw new Error('unsupported component type ' + accessor.componentType)
  }
  return {
    position: read(prim.attributes.POSITION) as Float32Array,
    index: prim.indices !== undefined ? read(prim.indices) as Uint32Array | Uint16Array : null,
    normal: prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) as Float32Array : null,
  }
}
