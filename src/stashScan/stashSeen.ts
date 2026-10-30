/**
 * What the last «Синхронизация по экрану» saw in the stash (owner, 31.10.2026: «колонка справа которая показывает какие
 * предметы в схроне уже не нужны, и никуда не пригодятся»): item id → pieces, per profile and mode, of the items the
 * hideout, the quests or the Collector ever asked for. A new scan replaces it with what that scan saw; kept in the account
 * (items/itemCounts.ts), so the phone shows the PC's scan.
 */
import type { RaidMode } from '../domain/types'
import { createItemCountStore } from '../items/itemCounts'

export const stashSeenStore = createItemCountStore('stash', 'raidos-stash-seen-v1:', 'raidos-stash-seen-changed')

export const readStashSeen = (profileId: string, mode: RaidMode) => stashSeenStore.read(profileId, mode)
export const useStashSeen = (profileId: string, mode: RaidMode) => stashSeenStore.useCounts(profileId, mode)
