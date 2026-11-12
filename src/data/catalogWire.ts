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
const OLDER_LAYER: Partial<Record<MarkerLayerId, MarkerLayerId>> = { switch: 'landmark', btr: 'landmark', 'loot.key': 'loot.technical', 'spawn.pmc': 'spawn', 'spawn.scav': 'spawn', sniper: 'hazard' }

const hasGuideLinks = (quest: Quest) => Boolean(quest.objectiveDetails?.some((objective) => objective.build?.guide?.image || objective.build?.guide?.url))

/**
 * A build guide on the wire: its parts, without another site's picture and page (owner, 06.11.2026: «Удали все надписи… У нас
 * наши сборки, наши скриншоты»). An app before 0.6.0.260 draws that picture with the site's name under it; without the picture
 * it shows the owner's screenshot or the weapon, so the name goes at once on phones and PCs not yet updated too.
 */
function questForWire(quest: Quest): Quest {
  if (!hasGuideLinks(quest)) return quest
  return {
    ...quest,
    objectiveDetails: quest.objectiveDetails!.map((objective) => {
      const guide = objective.build?.guide
      if (!objective.build || !guide) return objective
      const parts = { ...guide }
      delete parts.image
      delete parts.url
      return { ...objective, build: { ...objective.build, guide: parts } }
    }),
  }
}

/**
 * The catalog for the wire: the newer layers' markers under a layer every app knows, the guides without other sites' links.
 * The same object when it has none of them.
 */
export function catalogForWire(dataset: AppDataset): AppDataset {
  const layered = dataset.markers.some((marker) => marker.layerId && OLDER_LAYER[marker.layerId])
  const linked = dataset.quests.some(hasGuideLinks)
  if (!layered && !linked) return dataset
  return {
    ...dataset,
    ...(linked ? { quests: dataset.quests.map(questForWire) } : {}),
    markers: !layered ? dataset.markers : dataset.markers.map((marker): MapMarker => {
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
  const pointsOf = new Map<string, number>()
  for (const marker of dataset.markers) if (marker.questId && marker.objectiveId) pointsOf.set(`${marker.questId}:${marker.objectiveId}`, (pointsOf.get(`${marker.questId}:${marker.objectiveId}`) ?? 0) + 1)
  const taken = new Map<string, number>()
  return {
    ...dataset,
    ...(renamed.size ? { quests: dataset.quests.map((quest) => withGameObjectiveIds(quest, renamed.get(quest.id))) } : {}),
    markers: dataset.markers.map((marker): MapMarker => {
      let next = marker
      if (next.wireLayer) {
        const { wireLayer, ...rest } = next
        next = { ...rest, layerId: wireLayer }
      }
      const ids = next.questId && next.objectiveId ? renamed.get(next.questId)?.get(next.objectiveId) : undefined
      if (!ids) return next
      // Objectives with one text and one point each: every point its own objective's id, in order, so a tick takes one
      // point off («Недоброжелатель»). An objective with several points: the first id.
      const key = `${next.questId}:${next.objectiveId}`
      const at = taken.get(key) ?? 0
      taken.set(key, at + 1)
      return { ...next, objectiveId: ids[pointsOf.get(key) === ids.length ? at : 0] }
    }),
  }
}

/** Per quest: the translated id of each objective with the game's own id beside it → those ids, in order (two or more, for a repeated text). */
function gameObjectiveIds(quests: readonly Quest[] | undefined) {
  const byQuest = new Map<string, Map<string, string[]>>()
  for (const quest of quests ?? []) {
    for (const objective of quest.objectiveDetails ?? []) {
      if (!objective.gameId || objective.gameId === objective.id) continue
      let ids = byQuest.get(quest.id)
      if (!ids) byQuest.set(quest.id, ids = new Map())
      ids.set(objective.id, [...(ids.get(objective.id) ?? []), objective.gameId])
    }
  }
  return byQuest
}

function withGameObjectiveIds(quest: Quest, ids: Map<string, string[]> | undefined): Quest {
  if (!ids) return quest
  const details = quest.objectiveDetails ?? []
  // `objectiveIds` lists the same objectives in the same order (src/data/catalogSource.ts): by position, so two objectives
  // with the same text keep their own ids; by text when the lists differ.
  const aligned = quest.objectiveIds?.length === details.length && quest.objectiveIds.every((id, index) => details[index]?.id === id)
  const renamed = (id: string) => ids.get(id)?.[0] ?? id
  // Each objective lists an item once (src/data/catalogSource.ts): the item's next row of one text is the next objective's.
  const taken = new Map<string, number>()
  const requirementId = (id: string, requirement: NonNullable<Quest['raidRequirements']>[number]) => {
    const key = `${id}:${requirement.purpose}:${requirement.itemId}`
    const at = taken.get(key) ?? 0
    taken.set(key, at + 1)
    const own = ids.get(id)!
    return own[Math.min(at, own.length - 1)]
  }
  return {
    ...quest,
    ...(quest.objectiveIds ? { objectiveIds: quest.objectiveIds.map((id, index) => aligned ? details[index]!.gameId ?? id : renamed(id)) } : {}),
    objectiveDetails: quest.objectiveDetails?.map((objective) => {
      if (!objective.gameId) return objective
      const { gameId, ...rest } = objective
      return gameId === objective.id ? rest : { ...rest, id: gameId, legacyId: objective.id }
    }),
    ...(quest.raidRequirements ? {
      raidRequirements: quest.raidRequirements.map((requirement) => {
        // A key several objectives need: each of them by its own game id.
        if (requirement.objectiveIds) {
          const objectiveIds = requirement.objectiveIds.map((id) => ids.has(id) ? requirementId(id, requirement) : id)
          return { ...requirement, objectiveId: objectiveIds[0], objectiveIds }
        }
        return requirement.objectiveId && ids.has(requirement.objectiveId) ? { ...requirement, objectiveId: requirementId(requirement.objectiveId, requirement) } : requirement
      }),
    } : {}),
  }
}
