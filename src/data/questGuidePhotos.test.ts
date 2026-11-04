import { describe, expect, it } from 'vitest'
import guides from './questGuidePhotos.json'
import captionsRu from './questGuideCaptionsRu.json'

interface Photo { id: string; caption: string; captionEn?: string; objectiveId?: string }
const data = guides as unknown as { quests: Record<string, { photos: Photo[] }>; files: Record<string, { file: string; url: string }> }
const photos = Object.values(data.quests).flatMap((quest) => quest.photos)

describe('«Фото мест» of the quests (src/components/QuestGuidePhotos.tsx, scripts/quest-guide-photos.mjs)', () => {
  it('holds no maps, only the places themselves (owner, 02.11.2026: «удали там фото с картами, там чужие карты»)', () => {
    const mapWords = /(^|[^а-яё])карт(а|е|у|ой|ы|ах|ами)?(?![а-яё])|\bmaps?\b/i
    expect(photos.length).toBeGreaterThan(900)
    expect(photos.filter((photo) => mapWords.test(`${photo.caption} ${photo.captionEn ?? ''}`))).toEqual([])
    expect(photos.filter((photo) => /map/i.test(data.files[photo.id]?.file ?? ''))).toEqual([])
    for (const file of ['LighthouseTransitToShoreline.png', 'WoodsTransitToReserve.png', 'LexOsClaymoreOverview.png', 'Textile 1 and 2 locations.png']) {
      expect(Object.values(data.files).some((entry) => entry.file === file)).toBe(false)
    }
  })

  it('names every picture in Russian, with the English caption kept for the English interface (owner: «что бы был перевод»)', () => {
    expect(photos.filter((photo) => photo.caption && !/[а-яё]/i.test(photo.caption))).toEqual([])
    expect(photos.find((photo) => photo.captionEn === 'Entrance to the OLI front offices')?.caption).toBe(captionsRu['Entrance to the OLI front offices'])
  })

  // Owner, 04.11.2026: «у каждого места должны быть свои фотографии. Разберись, в каком месте какие фотографии. А не просто
  // рандомно раскидай»: the wiki's walkthrough has a heading for each place (scripts/quest-guide-photos.mjs --link-places).
  it('«Что-то мне это напоминает…»: 27 places, every photo at its own', () => {
    const quest = data.quests['66d9cbb67b491f9d5304f6e6']!
    const fileOf = (photo: Photo) => data.files[photo.id]!.file
    const placesOf = (photo: Photo) => [photo.objectiveId, ...((photo as Photo & { alsoFor?: string[] }).alsoFor ?? [])]
    const at = (id: string) => quest.photos.filter((photo) => placesOf(photo).includes(id)).map(fileOf)
    expect(new Set(quest.photos.flatMap(placesOf)).size).toBe(27)
    expect(quest.photos.filter((photo) => !photo.objectiveId).map(fileOf)).toEqual([])
    // The body in the barbed wire, the amphibians, the hole, the burned girl (ids of the game's objectives).
    expect(at('66d9cbb67b491f9d5304f6eb')).toEqual(expect.arrayContaining(['ITARWireBody.png', 'ITARWireBodyDoor.png', 'Mysterious key path1.png', 'Mysterious key building entrance.png']))
    expect(at('66d9cbb67b491f9d5304f6eb')).not.toContain('ITARBurnedGirl.png')
    expect(at('66d9cbb67b491f9d5304f6e9')).toEqual(['ITARPizzaLover.png'])
    expect(at('66dacf2a88c7001436a67390')).toEqual(expect.arrayContaining(['ITARScaryHole.png', 'Mysterious key building entrance.png']))
    expect(at('66d9cbb67b491f9d5304f6ea')).toEqual(expect.arrayContaining(['ITARBurnedGirl.png', 'ITARBurnedGirlDoor.png', 'X-ray clinic outside.png']))
  })

  it('a photo names objectives by the game\'s own ids, never a text', () => {
    const ids = photos.flatMap((photo) => [photo.objectiveId, ...((photo as Photo & { alsoFor?: string[] }).alsoFor ?? [])]).filter(Boolean)
    expect(ids.length).toBeGreaterThan(600)
    expect(ids.filter((id) => !/^[0-9a-f]{24}$/.test(id!))).toEqual([])
  })

  it('lists a file for every photo and no file nobody uses (the server serves only the listed ones)', () => {
    const used = new Set(photos.map((photo) => photo.id))
    expect(photos.every((photo) => data.files[photo.id]?.url)).toBe(true)
    expect(Object.keys(data.files).filter((id) => !used.has(id))).toEqual([])
  })
})
