// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BATTLE_PASS_DOCUMENT_KINDS, battlePassDocumentKindsOf, battlePassDocumentPointOf, battlePassDocumentTitle, BATTLE_PASS_DOCUMENTS, type BattlePassDocumentKind } from './battlePassDocuments'
import GUIDE from './documentGuidePhotos.json'
import { documentPhotoUrl, pointPhotos, type DocumentGuide } from './documentGuide'
import { DOCUMENT_PICTURES } from '../assets/documentMarkers'

const guide = GUIDE as unknown as DocumentGuide

describe('the photos of the battle pass documents', () => {
  it('every photo has its file on the wiki\'s host (or is our own frame of the place), its kind and a caption in both languages; no maps among them', () => {
    const ids = Object.keys(guide.files)
    expect(ids.length).toBeGreaterThan(300)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{16}$/)
      const file = guide.files[id]! as { url?: string; file: string; own?: boolean }
      // our own photos (22.11.2026): the offline game's frames of the place, kept on our server, no address of their own
      if (file.own) expect(file.file).toMatch(/\.jpg$/)
      else {
        expect(file.url).toMatch(/^https:\/\/static\.wikia\.nocookie\.net\/.+\/scale-to-width-down\/1280\?cb=/)
        expect(file.file).toMatch(/_spawn_\d+\.(png|jpe?g|webp)$/i)
      }
      expect(BATTLE_PASS_DOCUMENT_KINDS[guide.photos[id]!.kind]).toBeDefined()
      expect(guide.photos[id]!.en).toBeTruthy()
      expect(guide.photos[id]!.ru).toMatch(/[а-яё]/i)
    }
  })

  it('all 12 maps, each photo listed once under its map and kind', () => {
    expect(Object.keys(guide.maps).sort()).toEqual(['customs', 'factory', 'ground-zero', 'icebreaker', 'interchange', 'lighthouse', 'reserve', 'shoreline', 'streets-of-tarkov', 'the-lab', 'the-labyrinth', 'woods'])
    const listed = Object.values(guide.maps).flatMap((kinds) => Object.values(kinds).flat())
    expect([...listed].sort()).toEqual(Object.keys(guide.files).sort())
    for (const kinds of Object.values(guide.maps)) {
      for (const [kind, ids] of Object.entries(kinds)) for (const id of ids ?? []) expect(guide.photos[id]!.kind).toBe(kind)
    }
  })

  it('a spot shows only photos of its own map, each once', () => {
    const mapOf = new Map(Object.entries(guide.maps).flatMap(([mapId, kinds]) => Object.values(kinds).flat().map((id) => [id!, mapId] as const)))
    const spots = Object.entries(guide.spots)
    expect(spots.flatMap(([, list]) => list).length).toBeGreaterThan(300)
    for (const [mapId, list] of spots) {
      for (const spot of list) {
        expect(new Set(spot.photos).size).toBe(spot.photos.length)
        for (const id of spot.photos) expect(mapOf.get(id)).toBe(mapId)
      }
    }
  })

  it('a point gets the photos of the nearest spot of its kind, and nothing from a spot further off', () => {
    // The old gas station on Customs: financial documents on the desk, project documentation by the door, 7 metres apart.
    const financial = pointPhotos(guide, 'customs', [-186.2, 317.6], ['financial'])
    // Since 23.11.2026 the place is followed by the document laid there by the photo worker, up close.
    expect(financial.map((id) => guide.photos[id]!.en)).toEqual(['On the desk inside old gas station building.', 'The document in place.'])
    const project = pointPhotos(guide, 'customs', [-179.9, 316], ['project'])
    // owner, 23.11.2026: each document laid exactly where the guide's picture shows it, then seen up close
    expect(project.map((id) => guide.photos[id]!.en)).toEqual(['Inside the old gas station building next to the entrance door.', 'The document in place.'])
    // A point with both kinds shows both, and the same photo once: the library's two financial places and its project shelf, each
    // with its close-up (23.11.2026).
    expect(pointPhotos(guide, 'customs', [-159.2, 78.6], ['financial', 'project']).length).toBe(6)
    // Too far from anything of this kind.
    expect(pointPhotos(guide, 'customs', [-186.2, 317.6], ['medical'])).toEqual([])
    expect(pointPhotos(guide, 'customs', [0, 0], ['financial'])).toEqual([])
    expect(pointPhotos(null, 'customs', [-186.2, 317.6], ['financial'])).toEqual([])
    expect(pointPhotos(guide, 'icebreaker', [0, 0], ['pmc-files'])).toEqual([])
    // owner, 20.11.2026: the Shoreline hangar between the village and the car exit is not «the white house in front of the T-90»
    expect(pointPhotos(guide, 'shoreline', [-232.5, -627.6], ['technical'])).toEqual([])
    expect(guide.maps.shoreline!.technical).toContain('fa4c79d9e970f24e')
  })

  it('on Interchange each blueprint spawn point shows its own room (reports 218/219, 24.11.2026)', () => {
    const first = (z: number, x: number, kind: 'blueprints' | 'financial') => {
      const ids = pointPhotos(guide, 'interchange', [z, x], [kind])
      return ids.length ? guide.photos[ids[0]!]!.en : null
    }
    // the offices between Goshan and OLI: two spawn points, two rooms, no photo shared
    const a = pointPhotos(guide, 'interchange', [53.1, -68.4], ['blueprints'])
    const b = pointPhotos(guide, 'interchange', [46.0, -79.1], ['blueprints'])
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
    expect(a.filter((id) => b.includes(id))).toEqual([])
    // the back of OLI: the PC island, the back office, and a spawn point the offline copy has no desk for — no neighbour's photo there
    expect(first(126.4, -46.7, 'blueprints')).toBe('In the PC cubicle in the back of OLI.')
    expect(first(110.6, -91.3, 'blueprints')).toMatch(/back offices of OLI/i)
    expect(pointPhotos(guide, 'interchange', [112.9, -84.9], ['blueprints'])).toEqual([])
    // the guide had the Burger Spot sofa and the shelf by the red sofa swapped
    expect(first(-99.0, -11.6, 'financial')).toMatch(/burger/i)
    expect(first(-134.0, 27.9, 'financial')).toMatch(/shelf/i)
  })

  it('the picture comes from our server', () => {
    const [id] = pointPhotos(guide, 'customs', [-186.2, 317.6], ['financial'])
    expect(documentPhotoUrl(guide, id!, true)).toMatch(/^https:\/\/raidos\.app\/v1\/guide-images\/wiki-[0-9a-f]{16}-t\.(png|jpg)\?v=\d+$/)
    expect(documentPhotoUrl(guide, id!, false)).toMatch(/^https:\/\/raidos\.app\/v1\/guide-images\/wiki-[0-9a-f]{16}\.(png|jpg)\?v=\d+$/)
  })

  it('knows what a marker stands for: a pin placed by hand or a point of the live feed', () => {
    const pin = { id: 'customs-battle-pass-documents-2', mapId: 'customs' }
    expect(battlePassDocumentPointOf(pin)).toBe(BATTLE_PASS_DOCUMENTS.customs![2])
    expect(battlePassDocumentKindsOf(pin)).toEqual(['financial'])
    const live = { id: 'customs-battle-pass-documents-live-0', mapId: 'customs', itemId: BATTLE_PASS_DOCUMENT_KINDS.project.itemId }
    expect(battlePassDocumentPointOf(live)).toBeUndefined()
    expect(battlePassDocumentKindsOf(live)).toEqual(['project'])
    expect(battlePassDocumentKindsOf({ ...live, documentKinds: ['financial', 'project', 'unknown'] })).toEqual(['financial', 'project'])
  })

  it('a document is called by its kind, in the app\'s language', () => {
    expect(battlePassDocumentTitle(['test-docs'], 'ru')).toBe('Тестовая документация')
    expect(battlePassDocumentTitle(['test-docs'], 'en')).toBe('Test documentation')
    expect(battlePassDocumentTitle(['financial', 'project'], 'ru')).toBe('Финансовая документация, Проектная документация')
  })

  it('every kind has its picture', () => {
    const kinds = Object.keys(BATTLE_PASS_DOCUMENT_KINDS) as BattlePassDocumentKind[]
    for (const kind of kinds) expect(DOCUMENT_PICTURES[kind]).toBeTruthy()
  })

  it('the crop tool knows this list', () => {
    expect(readFileSync(new URL('../../scripts/crop-guide-photos.mjs', import.meta.url), 'utf8')).toContain("'documentGuidePhotos.json'")
  })
})
