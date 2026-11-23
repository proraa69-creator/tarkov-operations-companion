import { describe, expect, it } from 'vitest'
import { buildArmorCatalog, defaultPlates, kitPieces, likelyKit, randomKit, RANGE_TARGETS, readZones } from './rangeArmor'
import { fireAt, freshBody, realResistance, seededRandom } from './rangeModel'
import { landing, series, shootOnce, timeToKill, behindCover } from './rangeShot'
import fixture from './fixtures/rangeItems.json'

const catalog = buildArmorCatalog({ items: fixture.items, materials: fixture.armorMaterials, names: fixture.names, imageBase: 'https://assets.tarkov.dev' })
const killa = RANGE_TARGETS.find((target) => target.key === 'bosskilla')!

describe('the range armour catalogue (json.tarkov.dev items)', () => {
  it('reads the zones of the file', () => {
    expect(readZones(['Collider Type RibcageUp', 'Armor Zone Plate_Korund_chest', 'Collider Type Nope'])).toEqual({ colliders: ['RibcageUp'], plates: ['Plate_Korund_chest'] })
  })

  it('sorts the items by kind and keeps the built-in parts and the plate slots', () => {
    expect(catalog.items.get('5c0e874186f7745dc7616606')?.kind).toBe('helmet')
    expect(catalog.items.get('5c0e842486f77443a74d2976')?.kind).toBe('face')
    expect(catalog.items.get('603409c80ca681766b6a0fb2')?.kind).toBe('eyewear')
    expect(catalog.items.get('656f611f94b480b8a500c0db')?.kind).toBe('plate')
    const vest = catalog.items.get('5c0e541586f7747fa54205c9')!
    expect(vest.kind).toBe('armor')
    expect(vest.pieces.map((piece) => piece.key)).toEqual(expect.arrayContaining(['armor:Soft_armor_front', 'armor:Collar', 'armor:Groin']))
    expect(vest.plateSlots.map((slot) => [slot.name, slot.defaultPlate, slot.softReduce])).toEqual([
      ['Front_plate', '656f611f94b480b8a500c0db', true],
      ['Back_plate', '656efaf54772930db4031ff5', true],
    ])
    // glasses guard the eyes
    expect(catalog.items.get('603409c80ca681766b6a0fb2')?.pieces[0]?.colliders).toEqual(['Eyes'])
    // a round's penetration deviation
    expect(catalog.deviation['54527ac44bdc2d36668b4567']).toBeGreaterThan(0)
  })

  it('dresses Killa as the game does: the helmet with its visor, 6B13 with Granit plates over soft armour', () => {
    const choice = likelyKit(catalog, killa)
    expect(choice).toMatchObject({ helmet: '5c0e874186f7745dc7616606', visor: '5c0e842486f77443a74d2976', body: '5c0e541586f7747fa54205c9' })
    expect(choice.plates).toEqual({ Front_plate: '656f611f94b480b8a500c0db', Back_plate: '656efaf54772930db4031ff5' })
    const pieces = kitPieces(catalog, choice)
    const front = pieces.find((piece) => piece.key === 'plate:Front_plate')!
    expect(front.plates).toEqual(['Plate_Korund_chest'])
    expect(front.softReduce).toBe(true)
    expect(pieces.find((piece) => piece.key.startsWith('visor:'))?.colliders).toEqual(expect.arrayContaining(['Eyes', 'Jaw']))
    expect(randomKit(catalog, killa, seededRandom(1)).body).toBe('5c0e541586f7747fa54205c9')
  })

  it('a carrier comes with its plates; a plate only covers its slot’s zone', () => {
    const plates = defaultPlates(catalog, '5e4abb5086f77406975c9342')
    expect(plates).toEqual({ Front_plate: '656fa76500d62bcd2e024080', Back_plate: '656fa76500d62bcd2e024080' })
    const pieces = kitPieces(catalog, { body: '5e4abb5086f77406975c9342', plates })
    expect(pieces.find((piece) => piece.key === 'plate:Front_plate')?.plates).toEqual(['Plate_Granit_SAPI_chest'])
    expect(pieces.find((piece) => piece.key === 'plate:Back_plate')?.plates).toEqual(['Plate_Granit_SAPI_back'])
  })

  it('a chest shot at Killa meets the Granit plate first, then the soft insert', () => {
    const pieces = kitPieces(catalog, likelyKit(catalog, killa))
    const body = freshBody({ Head: 70, Chest: 210, Stomach: 170, LeftArm: 100, RightArm: 100, LeftLeg: 120, RightLeg: 120 })
    const shot = fireAt(pieces, body, { collider: 'RibcageUp', plate: 'Plate_Korund_chest' }, { damage: 60, penetration: 70, armorDamage: 0.5 }, () => 0)
    expect(shot.stages.map((stage) => stage.layers.map((layer) => layer.key))).toEqual([['plate:Front_plate'], ['body:armor:Soft_armor_front']])
    expect(shot.penetrated).toBe(true)
  })
})

describe('shots at the range', () => {
  it('lands on the aim without spread, recoil or sway, the drop below it', () => {
    expect(landing({ x: 1, y: 130 }, { distance: 100, spread: false, recoil: false, sway: false, recoilVertical: 100, recoilHorizontal: 200, dropCm: -4 }, 3, Math.random)).toEqual({ x: 1, y: 126 })
  })

  it('a cover takes the bullets behind it', () => {
    expect(behindCover('low', 0, 100)).toBe(true)
    expect(behindCover('low', 0, 140)).toBe(false)
    const body = freshBody({ Head: 35, Chest: 85, Stomach: 70, LeftArm: 60, RightArm: 60, LeftLeg: 65, RightLeg: 65 })
    const shot = shootOnce([], body, 'front', { x: 0, y: 60 }, { distance: 50, spread: false, recoil: false, sway: false, recoilVertical: 0, recoilHorizontal: 0, dropCm: 0 }, { damage: 50, penetration: 30, armorDamage: 0.4 }, 'low', 0, Math.random)
    expect(shot.cover).toBe(true)
    expect(body.current.LeftLeg).toBe(65)
  })

  it('a series counts the shots to kill', () => {
    const health = { Head: 35, Chest: 85, Stomach: 70, LeftArm: 60, RightArm: 60, LeftLeg: 65, RightLeg: 65 }
    const setup = { distance: 10, spread: false, recoil: false, sway: false, recoilVertical: 0, recoilHorizontal: 0, dropCm: 0 }
    // 50 damage to an unarmoured thorax of 85: two shots, every time
    const result = series([], health, [], { collider: 'RibcageUp', view: 'front' }, { damage: 50, penetration: 30, armorDamage: 0.4 }, setup, 20, seededRandom(3))
    expect(result.mean).toBe(2)
    expect(result.killedShare).toBe(1)
    expect(timeToKill(2, 600, 0.02)).toBeCloseTo(0.12, 6)
  })

  it('the resistance of a worn plate falls with its durability', () => {
    expect(realResistance(5, 25, 50)).toBeLessThan(realResistance(5, 50, 50))
  })
})
