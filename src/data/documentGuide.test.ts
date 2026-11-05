// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BATTLE_PASS_DOCUMENT_KINDS, battlePassDocumentKindsOf, battlePassDocumentPointOf, BATTLE_PASS_DOCUMENTS, type BattlePassDocumentKind } from './battlePassDocuments'
import GUIDE from './documentGuidePhotos.json'
import { documentPhotoUrl, pointPhotos, type DocumentGuide } from './documentGuide'
import { DOCUMENT_PICTURES } from '../assets/documentMarkers'

const guide = GUIDE as unknown as DocumentGuide

describe('the photos of the battle pass documents', () => {
  it('every photo has its file on the wiki\'s host, its kind and a caption in both languages; no maps among them', () => {
    const ids = Object.keys(guide.files)
    expect(ids.length).toBeGreaterThan(300)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{16}$/)
      expect(guide.files[id]!.url).toMatch(/^https:\/\/static\.wikia\.nocookie\.net\/.+\/scale-to-width-down\/1280\?cb=/)
      expect(guide.files[id]!.file).toMatch(/_spawn_\d+\.(png|jpe?g|webp)$/i)
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
    expect(financial.map((id) => guide.photos[id]!.en)).toEqual(['On the desk inside old gas station building.'])
    const project = pointPhotos(guide, 'customs', [-179.9, 316], ['project'])
    expect(project.map((id) => guide.photos[id]!.en)).toEqual(['Inside the old gas station building next to the entrance door.'])
    // A point with both kinds shows both, and the same photo once.
    expect(pointPhotos(guide, 'customs', [-159.2, 78.6], ['financial', 'project']).length).toBe(4)
    // Too far from anything of this kind.
    expect(pointPhotos(guide, 'customs', [-186.2, 317.6], ['medical'])).toEqual([])
    expect(pointPhotos(guide, 'customs', [0, 0], ['financial'])).toEqual([])
    expect(pointPhotos(null, 'customs', [-186.2, 317.6], ['financial'])).toEqual([])
    expect(pointPhotos(guide, 'icebreaker', [0, 0], ['pmc-files'])).toEqual([])
  })

  it('the picture comes from our server', () => {
    const [id] = pointPhotos(guide, 'customs', [-186.2, 317.6], ['financial'])
    expect(documentPhotoUrl(guide, id!, true)).toMatch(/^https:\/\/raidos\.app\/v1\/guide-images\/wiki-[0-9a-f]{16}-t\.png\?v=\d+$/)
    expect(documentPhotoUrl(guide, id!, false)).toMatch(/^https:\/\/raidos\.app\/v1\/guide-images\/wiki-[0-9a-f]{16}\.png\?v=\d+$/)
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

  it('every kind has its picture', () => {
    const kinds = Object.keys(BATTLE_PASS_DOCUMENT_KINDS) as BattlePassDocumentKind[]
    for (const kind of kinds) expect(DOCUMENT_PICTURES[kind]).toBeTruthy()
  })

  it('the crop tool knows this list', () => {
    expect(readFileSync(new URL('../../scripts/crop-guide-photos.mjs', import.meta.url), 'utf8')).toContain("'documentGuidePhotos.json'")
  })
})
