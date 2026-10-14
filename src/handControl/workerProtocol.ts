import type { Point3 } from './types'

export type WorkerRequest =
  | { type: 'init'; base: string; compute: 'auto' | 'GPU' | 'CPU' }
  | { type: 'frame'; id: number; t: number; bitmap: ImageBitmap }
  | { type: 'close' }

export type WorkerHand = { image: Point3[]; world: Point3[]; score: number; handedness: 'Left' | 'Right' }

export type WorkerResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'result'; id: number; delegate: 'GPU' | 'CPU'; inferenceMs: number; width: number; height: number; hand: WorkerHand | null }
  | { type: 'error'; id?: number; message: string }
