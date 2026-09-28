import type { RaidMode, TaskProgressRecord, PlayerProfileSnapshot, AppDataset } from '../../../src/domain/types'
export type { RaidMode, PlayerProfileSnapshot, AppDataset }
export interface SyncEvent {
  taskId: string
  status: 'active' | 'completed' | 'failed'
  timestamp: string
}
export interface SyncRequest {
  mode: RaidMode
  accountId: number
  characterId: string
  events: SyncEvent[]
}
export interface SyncResponse {
  revision: string
  records: TaskProgressRecord[]
  coverage: 'partial'
}
