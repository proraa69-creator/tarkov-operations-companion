import { describe, expect, it } from 'vitest'
import { figureLayers, hitOnFigure, insidePolygon, partLabelPoints, type FigureIndex, type FigureZone } from './rangeFigures'
import { fireAt, freshBody, PMC_HEALTH, type ArmorPiece } from './rangeModel'
import { figureGeometry } from './rangeShot'

const square = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const zones: FigureZone[] = [
  { type: 'RibcageUp', part: 'Chest', depth: 4.9, poly: square(-15, 120, 15, 145) },
  { type: 'SpineTop', part: 'Chest', depth: 5.2, poly: square(-15, 120, 15, 145) },
  { type: 'LeftUpperArm', part: 'LeftArm', depth: 4.8, poly: square(12, 115, 22, 145) },
  { type: 'RibcageUp', part: 'Chest', plate: 'Plate_Granit_SAPI_chest', depth: 4.85, poly: square(-12, 118, 12, 146) },
  { type: 'RibcageLow', part: 'Stomach', plate: 'Plate_Granit_SSAPI_side_left_high', depth: 4.9, poly: square(13, 105, 17, 125) },
  { type: 'HeadCommon', part: 'Head', depth: 4.9, poly: square(-8, 158, 8, 174) },
  { type: 'LeftSideChestDown', part: 'Stomach', depth: 5, poly: square(13, 104, 17, 124) },
]

describe('the pictured figure', () => {
  it('hits the nearest collider, the plate in front only when the kit has it', () => {
    expect(hitOnFigure(zones, 0, 130)).toEqual({ collider: 'RibcageUp' })
    expect(hitOnFigure(zones, 0, 130, new Set(['Plate_Granit_SAPI_chest']))).toEqual({ collider: 'RibcageUp', plate: 'Plate_Granit_SAPI_chest' })
    // the arm is nearer than the chest where they overlap
    expect(hitOnFigure(zones, 14, 130)?.collider).toBe('LeftUpperArm')
    expect(hitOnFigure(zones, 40, 130)).toBeUndefined()
    expect(hitOnFigure(zones, 0, 166)?.angle).toBeLessThan(10)
    expect(insidePolygon(square(0, 0, 1, 1), 0.5, 0.5)).toBe(true)
    expect(partLabelPoints(zones).Chest).toEqual({ x: 0, y: 132.5 })
  })

  it('a side plate that stops the bullet hurts the stomach (the game’s model)', () => {
    const plate: ArmorPiece = { key: 'plate:Left_side_plate', itemId: 'p', name: 'p', armorClass: 6, maxDurability: 50, durability: 50, material: 'Ceramic', destructibility: 0.6, bluntThroughput: 0.3, colliders: [], plates: ['Plate_Granit_SSAPI_side_left_high'], removable: true }
    const body = freshBody(PMC_HEALTH)
    const spot = figureGeometry({ front: zones }).hit('front', 15, 110, new Set(['Plate_Granit_SSAPI_side_left_high']))!
    expect(spot.plate).toBe('Plate_Granit_SSAPI_side_left_high')
    expect(spot.collider).toBe('LeftSideChestDown')
    const shot = fireAt([plate], body, spot, { damage: 50, penetration: 20, armorDamage: 0.4 }, () => 0.999)
    expect(shot.part).toBe('Stomach')
    expect(body.current.Stomach).toBeLessThan(70)
  })

  it('lays the kit over the bare character: armour, then mask and glasses, then the helmet (with its visor when pictured)', () => {
    const picture = (file: string) => ({ file, x: -30, top: 185, width: 60, height: 185 })
    const index: FigureIndex = {
      scale: 0.75,
      pictures: {
        'bare-bosskilla': { front: picture('bare-bosskilla.front.webp') },
        'body-pmcusec': { front: picture('body-pmcusec.front.webp') },
        'worn-vest': { front: picture('worn-vest.front.webp') },
        'worn-helmet': { front: picture('worn-helmet.front.webp') },
        'worn-helmet-visor': { front: picture('worn-helmet-visor.front.webp') },
      },
    }
    const killa = figureLayers(index, 'bosskilla', { helmet: 'helmet', visor: 'visor', body: 'vest', plates: {} }, 'front')!
    expect(killa.base.file).toBe('bare-bosskilla.front.webp')
    expect(killa.layers.map((layer) => layer.file)).toEqual(['worn-vest.front.webp', 'worn-helmet-visor.front.webp'])
    // no bare picture of the character: the PMC body
    expect(figureLayers(index, 'assault', { helmet: 'helmet', plates: {} }, 'front')?.base.file).toBe('body-pmcusec.front.webp')
    expect(figureLayers(index, 'assault', { helmet: 'helmet', plates: {} }, 'back')).toBeUndefined()
  })
})
