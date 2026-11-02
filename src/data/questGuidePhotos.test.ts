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

  it('lists a file for every photo and no file nobody uses (the server serves only the listed ones)', () => {
    const used = new Set(photos.map((photo) => photo.id))
    expect(photos.every((photo) => data.files[photo.id]?.url)).toBe(true)
    expect(Object.keys(data.files).filter((id) => !used.has(id))).toEqual([])
  })
})
