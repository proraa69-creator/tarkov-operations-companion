import type { AppDataset, MapMarker, MarkerLayerId, Quest } from '../domain/types'

/**
 * The catalog as the server sends it to every app version (owner, 02.11.2026: a player's older app fell on «Карты» with
 * «Cannot read properties of undefined (reading 'size')» — the server of 0.6.0.179 sent the new «Рубильники» layer, an
 * app before it has no icon for that layer, and its map draws every layer it is not told to hide). A layer added after
 * apps are in players' hands travels as one all of them know (hidden by default there), its own name beside it
 * (`wireLayer`); the app puts it back on arrival (src/data/tarkovJsonClient.ts), and the server writes it so
 * (server/src/services/questBase.ts).
 *
 * Objectives travel the same way: a tarkov.dev objective's `id` is its translated text, as every app before 0.6.0.184
 * keys its ticks, and the game's own id rides beside it (`gameId`, src/data/objectiveDetails.ts). This app keys them by
 * the game's id: the text changes with the language and tarkov.dev's wording, and a tick whose text has a comma or
 * quotes never reached the server (owner, 02.11.2026: «Сделай … постоянные id целей»).
 */
const OLDER_LAYER: Partial<Record<MarkerLayerId, MarkerLayerId>> = { switch: 'landmark' }

/** The catalog for the wire: the newer layers' markers under a layer every app knows. The same object when it has none. */
export function catalogForWire(dataset: AppDataset): AppDataset {
  if (!dataset.markers.some((marker) => marker.layerId && OLDER_LAYER[marker.layerId])) return dataset
  return {
    ...dataset,
    markers: dataset.markers.map((marker): MapMarker => {
      const older = marker.layerId ? OLDER_LAYER[marker.layerId] : undefined
      return older ? { ...marker, layerId: older, wireLayer: marker.layerId } : marker
    }),
  }
}

/**
 * The catalog as the app keeps it: every marker on its own layer again, every objective under the game's id (its
 * translated text kept as `legacyId`). The same object when nothing travelled so — a catalog read back from the cache
 * is already so.
 */
export function catalogFromWire(dataset: AppDataset): AppDataset {
  const layered = Boolean(dataset.markers?.some((marker) => marker.wireLayer))
  const renamed = gameObjectiveIds(dataset.quests)
  if (!layered && !renamed.size) return dataset
  return {
    ...dataset,
    ...(renamed.size ? { quests: dataset.quests.map((quest) => withGameObjectiveIds(quest, renamed.get(quest.id))) } : {}),
    markers: dataset.markers.map((marker): MapMarker => {
      let next = marker
      if (next.wireLayer) {
        const { wireLayer, ...rest } = next
        next = { ...rest, layerId: wireLayer }
      }
      const objectiveId = next.questId && next.objectiveId ? renamed.get(next.questId)?.get(next.objectiveId) : undefined
      return objectiveId ? { ...next, objectiveId } : next
    }),
  }
}

/** Per quest: the translated id of each objective with the game's own id beside it → that id (the first, for a repeated text). */
function gameObjectiveIds(quests: readonly Quest[] | undefined) {
  const byQuest = new Map<string, Map<string, string>>()
  for (const quest of quests ?? []) {
    for (const objective of quest.objectiveDetails ?? []) {
      if (!objective.gameId || objective.gameId === objective.id) continue
      let ids = byQuest.get(quest.id)
      if (!ids) byQuest.set(quest.id, ids = new Map())
      if (!ids.has(objective.id)) ids.set(objective.id, objective.gameId)
    }
  }
  return byQuest
}

function withGameObjectiveIds(quest: Quest, ids: Map<string, string> | undefined): Quest {
  if (!ids) return quest
  const details = quest.objectiveDetails ?? []
  // `objectiveIds` lists the same objectives in the same order (src/data/catalogSource.ts): by position, so two objectives
  // with the same text keep their own ids; by text when the lists differ.
  const aligned = quest.objectiveIds?.length === details.length && quest.objectiveIds.every((id, index) => details[index]?.id === id)
  const renamed = (id: string) => ids.get(id) ?? id
  return {
    ...quest,
    ...(quest.objectiveIds ? { objectiveIds: quest.objectiveIds.map((id, index) => aligned ? details[index]!.gameId ?? id : renamed(id)) } : {}),
    objectiveDetails: quest.objectiveDetails?.map((objective) => {
      if (!objective.gameId) return objective
      const { gameId, ...rest } = objective
      return gameId === objective.id ? rest : { ...rest, id: gameId, legacyId: objective.id }
    }),
    ...(quest.raidRequirements ? {
      raidRequirements: quest.raidRequirements.map((requirement) => requirement.objectiveId && ids.has(requirement.objectiveId) ? { ...requirement, objectiveId: renamed(requirement.objectiveId) } : requirement),
    } : {}),
  }
}
