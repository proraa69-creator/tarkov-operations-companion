// Computes the cloth swing weights off the main thread (see swayWeights.ts); bundled inline by Vite.
import { computeSwayWeights, type SwayWeights } from './swayWeights'

export interface SwayRequest { id: number; position: Float32Array; index: Uint32Array | Uint16Array | null }
export interface SwayReply { id: number; result: SwayWeights | null }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SwayRequest>) => void) | null
  postMessage(message: SwayReply, transfer: Transferable[]): void
}

scope.onmessage = (event) => {
  const { id, position, index } = event.data
  let result: SwayWeights | null
  try { result = computeSwayWeights(position, index) } catch { result = null }
  scope.postMessage({ id, result }, result ? [result.weights.buffer] : [])
}
