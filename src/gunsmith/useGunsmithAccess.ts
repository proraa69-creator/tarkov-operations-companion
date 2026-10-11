import { useCallback, useMemo } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { calculateAvailability } from '../progression/requirementEngine'
import { playerAccess, traderKey, useTraderLevels } from './traderLevels'

/**
 * What the player of this mode can buy (src/gunsmith/traderLevels.ts): trader loyalty (estimate or own choice), the flea
 * from character level 15, tasks done (offers a task unlocks). Also the traders by key for their portraits.
 */
export function useGunsmithAccess() {
  const { data } = useTarkovData()
  const state = useAppState()
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const statusOf = useCallback((questId: string) => availability.get(questId)?.status, [availability])
  const { infos, setLevel } = useTraderLevels(state.raidMode, data.traders, data.quests, statusOf, progress.playerLevel)
  const fleaEnabled = data.metadata?.fleaMarket?.enabled !== false
  const access = useMemo(() => playerAccess(infos, progress.playerLevel, fleaEnabled, (taskId) => statusOf(taskId) === 'completed'), [fleaEnabled, infos, progress.playerLevel, statusOf])
  const traders = useMemo(() => new Map(data.traders.map((trader) => [traderKey(trader), trader])), [data.traders])
  const questName = useCallback((taskId: string) => data.quests.find((quest) => quest.id === taskId)?.name, [data.quests])
  return { access, infos, setLevel, traders, questName, mode: state.raidMode, playerLevel: progress.playerLevel }
}

export type GunsmithAccess = ReturnType<typeof useGunsmithAccess>
