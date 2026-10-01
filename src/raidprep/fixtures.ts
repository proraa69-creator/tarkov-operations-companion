import type { HideoutStation, Item, MapMarker, ModeProgress, Quest } from '../domain/types'
import { createModeProgress } from '../domain/progress'

/** Small catalog builders for the raid-prep tests. */
export function item(id: string, name: string, extra: Partial<Item> = {}): Item {
  return { id, name, shortName: name, category: 'Бартер', description: '', prices: [], ...extra }
}

export function quest(id: string, name: string, extra: Partial<Quest> = {}): Quest {
  return { id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra }
}

export function station(id: string, name: string, levels: HideoutStation['levels']): HideoutStation {
  return { id, name, level: 0, status: 'locked', requirements: [], bonus: '', maxLevel: levels?.length, levels }
}

export function progressWith(records: Record<string, 'active' | 'completed' | 'failed'>, extra: Partial<ModeProgress> = {}): ModeProgress {
  const progress = createModeProgress()
  for (const [taskId, status] of Object.entries(records)) progress.taskProgress[taskId] = { taskId, status, source: 'eft-log', updatedAt: '2026-09-01T00:00:00.000Z' }
  return { ...progress, ...extra }
}

export function marker(id: string, position: [number, number], extra: Partial<MapMarker> = {}): MapMarker {
  return { id, mapId: 'customs', type: 'quest', layerId: 'quest.zone', title: id, description: '', position, ...extra }
}
