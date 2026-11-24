import { useEffect, useMemo, useState } from 'react'
import type { MapMarker, Quest, RaidMode } from '../domain/types'
import { fetchPlannerPeople, type Friend, type PlannerPerson, type SquadMember } from './socialClient'
import { loadFriends, useFriends } from './useFriends'
import { loadSquad, useSquad } from './useSquad'
import { friendColors } from './friendColors'
import { friendLabel } from './squadLabels'
import { objectivePointsOnMap } from './raidPlanEngine'
import { doneObjectives, questMapIdsForSquad } from './squadOverview'
import { useSquadSettings } from './squadSettings'

const KEY = 'raidos-map-friend-quests-v1'
const SQUAD_KEY = 'raidos-map-squad-quests-v1'
/** The friends progress endpoint takes this many at once (server/src/routes/friends.ts). */
const MAX_FRIENDS = 10
/** While the layer is on, the friends' and the squad's quests come again from the server this often (owner, 12.11.2026). */
export const FRIEND_QUESTS_REFRESH_MS = 30_000

export interface FriendQuestPoint {
  key: string
  position: [number, number]
  color: string
  nickname: string
  questId: string
  questName: string
  questKind?: Quest['kind']
  trader: string
  /** This point's objective. */
  objectiveId: string
  label: string
  /** What the friend has still to do in this quest on this map, this point's objective among them (the point's window). */
  left: Array<{ objectiveId: string; text: string }>
  /** Several friends on one point stand side by side. */
  slot: number
}

export interface FriendLegendEntry { friendId: string; nickname: string; color: string; quests: number; squad?: boolean }

/** The squad mates (not you) as people of the layer: their active quests and progress from the squad's overview. */
export function squadPeople(members: readonly SquadMember[] | undefined): PlannerPerson[] {
  return (members ?? []).filter((member) => !member.isYou).map((member) => ({
    id: member.memberId, nickname: member.nickname, hidden: member.hidden === true, activeQuestIds: member.activeQuestIds ?? [],
    objectives: member.objectives ?? {}, completedCount: member.completedCount ?? 0, lastSyncAt: member.lastSyncAt ?? null,
  }))
}

/** The friends first, then the squad mates who are not among them (a friend in the squad shows once). */
export function mergeLayerPeople(friends: readonly PlannerPerson[], squad: readonly PlannerPerson[]): Array<PlannerPerson & { squad?: boolean }> {
  const seen = new Set(friends.map((person) => person.id))
  const squadIds = new Set(squad.map((person) => person.id))
  return [
    ...friends.map((person) => (squadIds.has(person.id) ? { ...person, squad: true } : person)),
    ...squad.filter((person) => !seen.has(person.id)).map((person) => ({ ...person, squad: true })),
  ]
}

function readOn(key: string) {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

/** «Квесты друзей» or «Квесты отряда»: which button of the map this layer is. */
export type QuestLayerWho = 'friends' | 'squad'

/**
 * «Квесты друзей» on the map (owner, 12.10.2026: «кнопку на карте сверху, квесты друга… появятся на карте точки квестов,
 * подсвечиваются эти точки согласно присвоеному цвету в разделе друзья»): the remaining objective points of every friend
 * who shares progress, in the friend's colour. Off by default; the choice is kept on this computer.
 * The same button shows the squad mates' quests by their nicknames, and while it is on both come again from the server
 * every half a minute (owner, 12.11.2026: «Они должны обновляться сами с сервера»).
 * The squad has its own button since 14.11.2026 (owner: «включил, поставил галочку на квесты отряда, у человека на карте появляется
 * кнопка сверху квесты отряда. По нажатию ее только потом появляются квесты. Также по цветам они различаются»): `who` 'squad' is
 * the squad mates only, there while «Настройки отряда» has «Квесты отряда» on; 'friends' is the friends only.
 */
export function useFriendQuestLayer(mode: RaidMode, mapId: string, quests: Quest[], markers: MapMarker[], who: QuestLayerWho = 'friends') {
  const { overview, signedIn } = useFriends({ poll: false })
  const squadState = useSquad(mode, { poll: false })
  const settings = useSquadSettings()
  const squadLayer = who === 'squad'
  const friends = useMemo(() => overview?.friends ?? [], [overview])
  const sharing = useMemo(() => (squadLayer ? [] : friends.filter((friend) => friend.sharesProgress).slice(0, MAX_FRIENDS)), [friends, squadLayer])
  const squadMates = useMemo(() => squadPeople(squadState.overview?.squad.members ?? squadState.mine?.squad?.members), [squadState.overview, squadState.mine])
  const ids = sharing.map((friend) => friend.friendId).join(',')
  const storageKey = squadLayer ? SQUAD_KEY : KEY
  const [on, setOn] = useState(() => readOn(storageKey))
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<{ key: string; people: PlannerPerson[]; error: string } | null>(null)
  const key = `${mode}:${ids}`

  // While on: again every half a minute while the app is in front (the friends list and the squad too).
  useEffect(() => {
    if (!on || !signedIn) return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      setTick((value) => value + 1)
      if (squadLayer) void loadSquad(mode)
      else void loadFriends()
    }, FRIEND_QUESTS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [on, signedIn, mode, squadLayer])

  useEffect(() => {
    if (!on || !ids) return
    let active = true
    fetchPlannerPeople(mode, ids.split(',')).then(
      (people) => { if (active) setResult({ key, people, error: '' }) },
      // a failed refresh keeps the points already shown
      (reason: unknown) => { if (active) setResult((current) => (current?.key === key && tick > 0 ? current : { key, people: [], error: reason instanceof Error ? reason.message : String(reason) })) },
    )
    return () => { active = false }
  }, [on, mode, ids, key, tick])

  const colors = useMemo(() => friendColors([...friends.map((friend) => friend.friendId), ...squadMates.map((mate) => mate.id).filter((id) => !friends.some((friend) => friend.friendId === id))]), [friends, squadMates])
  const people = useMemo(() => (squadLayer ? mergeLayerPeople([], squadMates) : ids && result?.key === key ? result.people : []), [squadLayer, result, key, ids, squadMates])
  const { points, legend } = useMemo(() => friendQuestPoints({ people, sharing, colors, quests, markers, mapId, mode }), [people, sharing, colors, quests, markers, mapId, mode])

  const toggle = () => setOn((value) => {
    try { localStorage.setItem(storageKey, value ? '0' : '1') } catch { /* storage unavailable: on for this visit only */ }
    return !value
  })
  return {
    who,
    /** Signed in: the friends' button is there (disabled without friends who share progress); the squad's in a squad, with it turned on. */
    available: squadLayer ? signedIn && settings.quests && squadMates.length > 0 : signedIn,
    sharing: squadLayer ? squadMates.length : sharing.length,
    on,
    toggle,
    loading: !squadLayer && on && Boolean(ids) && result?.key !== key,
    error: !squadLayer && result?.key === key ? result.error : '',
    points: on ? points : [],
    legend: on ? legend : [],
  }
}

export type FriendQuestLayer = ReturnType<typeof useFriendQuestLayer>

/** Every remaining objective point of each friend's active quests on this map, and the legend (who, which colour, how many quests). */
export function friendQuestPoints({ people, sharing, colors, quests, markers, mapId, mode }: {
  people: Array<PlannerPerson & { squad?: boolean }>; sharing: Friend[]; colors: Map<string, string>; quests: Quest[]; markers: MapMarker[]; mapId: string; mode: RaidMode
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
      const textOf = (point: (typeof left)[number]) => quest.objectiveDetails?.find((objective) => objective.id === point.objectiveId)?.description || point.title || quest.name
      const goals = left.map((point) => ({ objectiveId: point.objectiveId, text: textOf(point) }))
      for (const point of left) {
        const spot = `${point.position[0].toFixed(1)}:${point.position[1].toFixed(1)}`
        const slot = taken.get(spot) ?? 0
        taken.set(spot, slot + 1)
        out.push({
          key: `${person.id}:${questId}:${point.objectiveId}`, position: point.position, color, nickname,
          questId, questName: quest.name, ...(quest.kind ? { questKind: quest.kind } : {}), trader: quest.trader,
          objectiveId: point.objectiveId, label: point.title || quest.name, left: goals, slot,
        })
      }
    }
    legendOut.push({ friendId: person.id, nickname, color, quests: questCount, ...(person.squad ? { squad: true } : {}) })
  }
  return { points: out, legend: legendOut }
}
