import { describe, expect, it } from 'vitest'
import { photosOfPoint } from '../components/QuestGuidePhotos'
import { requiredItemCount } from '../raidprep/objectives'
import guide from './questGuidePhotos.json'
import places from './questPhotoPlaces.json'
import { TASK_OBJECTIVE_MERGES } from './catalogSource'

/**
 * «Ревизия. Маяк» after its objectives were folded into «any of three BRDMs» and «any of three Strykers» (release 353): each of
 * the six wiki photos stands under its objective and at its own place, and the quest asks two markers (owner, 28.11.2026:
 * «не хватает скринов и мест других брдм, точек нет, и еще должно быть в требованиях ×2 маркеров, надпись бартер убери»).
 */
const QUEST = '6179b4d1bca27a099552e04e'
const [BRDM, STRYKER] = TASK_OBJECTIVE_MERGES[QUEST]!
const MARKER = '5991b51486f77447b112d44f'
/** The zones' [x, z] in tarkov.dev's data (the server's quest base, 28.11.2026). */
const ZONES: Record<string, [number, number]> = {
  qlight_mark_vech1: [13.14, -503.23], qlight_mark_vech2: [-65.14, -691.74], qlight_mark_vech6: [8.42, 173.83],
  qlight_mark_vech3: [66.05, 516.78], qlight_mark_vech4: [-41.03, 16.5], qlight_mark_vech5: [187.4, -709.75],
}
/** Which photo shows which zone: the wiki's first, second and third BRDM and Stryker. */
const PHOTO_ZONE: Record<string, string> = {
  b5951639ee801fe8: 'qlight_mark_vech1', '9dc2cf810c6c240c': 'qlight_mark_vech2', eaa4b08a83b3af47: 'qlight_mark_vech6',
  '8bc9e81e9f245f7c': 'qlight_mark_vech3', '37bd9007373f176d': 'qlight_mark_vech4', f3d63cbfcaf028d6: 'qlight_mark_vech5',
}

const quest = (guide as unknown as { quests: Record<string, { photos: Array<{ id: string; objectiveId?: string }> }> }).quests[QUEST]!
const at = places as unknown as Record<string, [number, number]>
const files = Object.fromEntries(quest.photos.map((photo) => [photo.id, { file: 'photo.png', ...(at[photo.id] ? { at: at[photo.id] } : {}) }]))

describe('«Ревизия. Маяк»: every BRDM and Stryker with its photo and place', () => {
  it('each photo stands under its objective, none is left for the whole quest', () => {
    for (const photo of quest.photos) {
      const zone = PHOTO_ZONE[photo.id]
      expect(zone, photo.id).toBeTruthy()
      expect(photo.objectiveId, photo.id).toBe(BRDM!.zones.includes(zone!) ? BRDM!.keep : STRYKER!.keep)
    }
  })

  it('each point of an objective shows its own photo only', () => {
    for (const merge of [BRDM!, STRYKER!]) {
      const photos = quest.photos.filter((photo) => photo.objectiveId === merge.keep)
      expect(photos).toHaveLength(3)
      // A point on the map is [z, x]; a photo's place is [x, z].
      const points = merge.zones.map((zone) => [ZONES[zone]![1], ZONES[zone]![0]] as const)
      merge.zones.forEach((zone, index) => {
        expect(photosOfPoint(photos, files, points[index]!, points).map((photo) => PHOTO_ZONE[photo.id])).toEqual([zone])
      })
    }
  })

  it('asks two markers: one for the BRDM, one for the Stryker', () => {
    const requirements = [
      { itemId: MARKER, count: 1, purpose: 'mark' as const },
      { itemId: MARKER, count: 1, purpose: 'mark' as const },
    ]
    expect(requiredItemCount(requirements, MARKER)).toBe(2)
  })
})

describe('how many of an item a quest takes into its raids', () => {
  it('adds what objectives use up, counts a key or an item to find once', () => {
    expect(requiredItemCount([{ itemId: 'a', count: 3, purpose: 'place' }, { itemId: 'a', count: 2, purpose: 'place' }], 'a')).toBe(5)
    expect(requiredItemCount([{ itemId: 'key', count: 1, purpose: 'key' }, { itemId: 'key', count: 1, purpose: 'key' }], 'key')).toBe(1)
    expect(requiredItemCount([{ itemId: 'b', count: 5, purpose: 'find' }, { itemId: 'b', count: 5, purpose: 'handover' }], 'b')).toBe(5)
    expect(requiredItemCount([], 'c')).toBe(1)
  })
})
