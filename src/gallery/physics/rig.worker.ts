// Builds a boss model's physics rig off the main thread (the shape analysis and the rig, physics/rig.ts) for the
// Gallery's 3D viewer; the rig comes back as transferred typed arrays.
import type { BossSwayHints } from '../bossSwayHints'
import { rigFromMesh, rigTransferables, type PhysicsRig } from './rig'

export interface RigRequest {
  id: number
  position: Float32Array
  index: Uint32Array | Uint16Array | null
  hints?: BossSwayHints
  /** Mesh-space up in the viewer's rest pose. */
  up: [number, number, number]
}
export interface RigReply { id: number; rig: PhysicsRig | null }

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<RigRequest>) => void) | null
  postMessage(message: RigReply, transfer: Transferable[]): void
}

ctx.onmessage = (event) => {
  const { id, position, index, hints, up } = event.data
  let rig: PhysicsRig | null
  try { rig = rigFromMesh(position, index, hints, up) } catch { rig = null }
  ctx.postMessage({ id, rig }, rig ? rigTransferables(rig) : [])
}
