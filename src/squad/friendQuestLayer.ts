import { useEffect, useMemo, useState } from 'react'
import type { MapMarker, Quest, RaidMode } from '../domain/types'
import { fetchPlannerPeople, type Friend, type PlannerPerson } from './socialClient'
import { useFriends } from './useFriends'
import { friendColors } from './friendColors'
import { friendLabel } from './squadLabels'
import { objectivePointsOnMap } from './raidPlanEngine'
import { doneObjectives, questMapIdsForSquad } from './squadOverview'

const KEY = 'raidos-map-friend-quests-v1'
/** The friends progress endpoint takes this many at once (server/src/routes/friends.ts). */
const MAX_FRIENDS = 10

export interface FriendQuestPoint {
  key: string
  position: [number, number]
  color: string
  nickname: string
  questName: string
  label: string
  /** Several friends on one point stand side by side. */
  slot: number
}

export interface FriendLegendEntry { friendId: string; nickname: string; color: string; quests: number }

function readOn() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/**
 * «Квесты друзей» on the map (owner, 12.10.2026: «кнопку на карте сверху, квесты друга… появятся на карте точки квестов,
 * подсвечиваются эти точки согласно присвоеному цвету в разделе друзья»): the remaining objective points of every friend
 * who shares progress, in the friend's colour. Off by default; the choice is kept on this computer.
 */
export function useFriendQuestLayer(mode: RaidMode, mapId: string, quests: Quest[], markers: MapMarker[]) {
  const { overview, signedIn } = useFriends({ poll: false })
  const friends = useMemo(() => overview?.friends ?? [], [overview])
  const sharing = useMemo(() => friends.filter((friend) => friend.sharesProgress).slice(0, MAX_FRIENDS), [friends])
  const ids = sharing.map((friend) => friend.friendId).join(',')
  const [on, setOn] = useState(readOn)
  const [result, setResult] = useState<{ key: string; people: PlannerPerson[]; error: string } | null>(null)
  const key = `${mode}:${ids}`

  useEffect(() => {
    if (!on || !ids) return
    let active = true
    fetchPlannerPeople(mode, ids.split(',')).then(
      (people) => { if (active) setResult({ key, people, error: '' }) },
      (reason: unknown) => { if (active) setResult({ key, people: [], error: reason instanceof Error ? reason.message : String(reason) }) },
    )
    return () => { active = false }
  }, [on, mode, ids, key])

  const colors = useMemo(() => friendColors(friends.map((friend) => friend.friendId)), [friends])
  const people = useMemo(() => (result?.key === key ? result.people : []), [result, key])
  const { points, legend } = useMemo(() => friendQuestPoints({ people, sharing, colors, quests, markers, mapId, mode }), [people, sharing, colors, quests, markers, mapId, mode])

  const toggle = () => setOn((value) => {
    try { localStorage.setItem(KEY, value ? '0' : '1') } catch { /* storage unavailable: on for this visit only */ }
    return !value
  })
  return {
    /** Signed in: the button is there (disabled without friends who share progress). */
    available: signedIn,
    sharing: sharing.length,
    on,
    toggle,
    loading: on && Boolean(ids) && result?.key !== key,
    error: result?.key === key ? result.error : '',
    points: on ? points : [],
    legend: on ? legend : [],
  }
}

export type FriendQuestLayer = ReturnType<typeof useFriendQuestLayer>

/** Every remaining objective point of each friend's active quests on this map, and the legend (who, which colour, how many quests). */
export function friendQuestPoints({ people, sharing, colors, quests, markers, mapId, mode }: {
  people: PlannerPerson[]; sharing: Friend[]; colors: Map<string, string>; quests: Quest[]; markers: MapMarker[]; mapId: string; mode: RaidMode
}): { points: FriendQuestPoint[]; legend: FriendLegendEntry[] } {
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const byQuest = new Map<string, MapMarker[]>()
  for (const marker of markers) {
    if (!marker.questId || marker.mapId !== mapId || !Number.isFinite(marker.position?.[0]) || !Number.isFinite(marker.position?.[1])) continue
    byQuest.set(marker.questId, [...(byQuest.get(marker.questId) ?? []), marker])
  }
  const out: FriendQuestPoint[] = []
  const legendOut: FriendLegendEntry[] = []
  const taken = new Map<string, number>()
  for (const person of people) {
    if (person.isYou || person.hidden) continue
    const friend = sharing.find((entry) => entry.friendId === person.id)
    const nickname = person.nickname ?? (friend ? friendLabel(friend.nicknames, mode) : '—')
    const color = colors.get(person.id) ?? '#c4a665'
    let questCount = 0
    for (const questId of new Set(person.activeQuestIds)) {
      const quest = questsById.get(questId)
      if (!quest || quest.anyMap || !questMapIdsForSquad(quest).includes(mapId)) continue
      const done = doneObjectives(person, questId)
      const left = objectivePointsOnMap(byQuest.get(questId), mapId).filter((point) => !done.has(point.objectiveId))
      if (left.length) questCount += 1
      for (const point of left) {
        const spot = `${point.position[0].toFixed(1)}:${point.position[1].toFixed(1)}`
        const slot = taken.get(spot) ?? 0
        taken.set(spot, slot + 1)
        out.push({ key: `${person.id}:${questId}:${point.objectiveId}`, position: point.position, color, nickname, questName: quest.name, label: point.title || quest.name, slot })
      }
    }
    legendOut.push({ friendId: person.id, nickname, color, quests: questCount })
  }
  return { points: out, legend: legendOut }
}
