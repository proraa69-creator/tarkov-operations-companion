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
    // The body in the barbed wire, the amphibians, the hole, the burned girl (ids of the game's objectives). Since 24.11.2026 the
    // places are shot again in the offline game (owner: «снимать все снимки, которые есть»): our own frames of each place in place
    // of the wiki's pictures, each frame at the place it was shot at.
    const ownAt = (id: string) => quest.photos.filter((photo) => placesOf(photo).includes(id) && (data.files[photo.id] as { own?: boolean }).own).map((photo) => photo.id)
    for (const id of ['66d9cbb67b491f9d5304f6eb', '66d9cbb67b491f9d5304f6e9', '66dacf2a88c7001436a67390', '66d9cbb67b491f9d5304f6ea']) {
      expect(at(id).length).toBeGreaterThan(0)
      expect(ownAt(id).length).toBeGreaterThan(0)
    }
    expect(ownAt('66d9cbb67b491f9d5304f6eb').filter((id) => ownAt('66d9cbb67b491f9d5304f6ea').includes(id))).toEqual([])
    expect(at('66d9cbb67b491f9d5304f6eb')).not.toContain('ITARBurnedGirl.png')
  })

  it('a photo names objectives by the game\'s own ids, never a text', () => {
    const ids = photos.flatMap((photo) => [photo.objectiveId, ...((photo as Photo & { alsoFor?: string[] }).alsoFor ?? [])]).filter(Boolean)
    expect(ids.length).toBeGreaterThan(600)
    expect(ids.filter((id) => !/^[0-9a-f]{24}$/.test(id!))).toEqual([])
  })

  it('lists a file for every photo and no file nobody uses (the server serves only the listed ones)', () => {
    const used = new Set(photos.map((photo) => photo.id))
    // our own frames of the place (22.11.2026, `own`) have no address: the server keeps them in its guide images folder
    const files = data.files as Record<string, { url?: string; file: string; own?: boolean }>
    expect(photos.filter((photo) => !files[photo.id]?.url && !files[photo.id]?.own).map((photo) => photo.id)).toEqual([])
    expect(Object.values(files).filter((file) => file.own && !/\.jpg$/.test(file.file))).toEqual([])
    expect(Object.keys(data.files).filter((id) => !used.has(id))).toEqual([])
  })

  // Owner, 26.11.2026 («Да, привяжи»): a photo shows at the map's point of the objective it is tied to; one tied to none shows
  // only in the quest card, under «Весь квест». Tied by where our frame was shot, the one objective on the map, the caption's
  // number or words, the walkthrough's groups (scratchpad tie2.cjs); left alone: overviews, photos with no caption and places
  // the game no longer has («Третий БРДМ»).
  it('ties nearly every photo to the objective whose place it shows', () => {
    const untied = photos.filter((photo) => !photo.objectiveId && !((photo as Photo & { alsoFor?: string[] }).alsoFor ?? []).length)
    expect(untied.length).toBeLessThanOrEqual(45)
    // «Знаток Резерва»: each room's photo at its own objective, each barracks' outside with that barracks' rooms
    const quest = data.quests['608974af4b05530f55550c21']!
    const at = (caption: string) => {
      const photo = quest.photos.find((entry) => entry.caption === caption)! as Photo & { alsoFor?: string[] }
      return [photo.objectiveId, ...(photo.alsoFor ?? [])].sort()
    }
    const east = { first: '608bd0a053b9dd01a116f474', duty: '608bd2465e0ef91ab810f98a', second: '608bd0c20637f21f9934b6e4' }
    const south = { first: '608bd136c61c4b541b381da3', second: '608bd149f597ad0a33574d74' }
    expect(at('2 этаж, вторая оружейная (RB-ORB3)')).toEqual([east.second])
    expect(at('3 этаж, дежурная (RB-OB)')).toEqual([east.duty])
    expect(at('4 этаж, первая оружейная (RB-ORB1)')).toEqual([south.first])
    expect(at('Все нужные комнаты снаружи')).toEqual([east.first, east.duty, east.second].sort())
    expect(at('Обе комнаты снаружи')).toEqual([south.first, south.second].sort())
  })

  // A player in the support chat, 26.11.2026 («По квесту городские разборки тут надо понюхать чтобы пометилось»): the quest's
  // photos were tied to no objective, so the map's point of «Пометить зону груза» showed none of them.
  it('«Городские разборки»: the truck under finding it and marking it, the spot for the marker under marking', () => {
    const quest = data.quests['63967028c4a91c5cb76abd81']!
    const under = (objective: string) => quest.photos.filter((photo) => [photo.objectiveId, ...((photo as Photo & { alsoFor?: string[] }).alsoFor ?? [])].includes(objective)).map((photo) => photo.id)
    expect(under('639aea2228d8a21b593a3491')).toEqual(['9d7d4d32e6fe2da7', 'd742e4f456b90b28'])
    expect(under('63bd64552803ffbfad0e3e48')).toEqual(['055a824fae5383c1', '9d7d4d32e6fe2da7'])
    expect(quest.photos.find((photo) => photo.id === 'd742e4f456b90b28')!.caption).toMatch(/вплотную/)
  })

  // Report 244 (26.11.2026): the reshoot dropped every wiki photo of an objective once one of its places had a frame of ours, so
  // the places no frame shows lost theirs. The quest drive of «Закрытый клуб» lies at one of four places: a photo of each.
  it('«Закрытый клуб»: a photo of each of the four places the drive can lie at', () => {
    const captions = data.quests['675c3582f6ddc329a90f9c6d']!.photos.map((photo) => photo.caption)
    // our frame with the arrow at the TV is the wiki's fourth place, not «Место появления 1» (the feed's own order)
    expect(captions).toEqual(['Южный вход Склада 17', 'Дверь в комнату', 'Первое место на полу под полкой рядом с дверью', 'Второе место на полу под столом', 'Третье место на столе', 'Четвёртое место за телевизором на столе'])
    // the same for the diary of «Пропавший информатор»: three places
    const diary = data.quests['63966fbeea19ac7ed845db2e']!.photos.map((photo) => photo.caption)
    expect(diary.filter((caption) => /место появления/i.test(caption))).toHaveLength(3)
  })
})
