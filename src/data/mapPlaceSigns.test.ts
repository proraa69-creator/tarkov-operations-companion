import { describe, expect, it } from 'vitest'
import { shopSignsOf, signLines, signThickness } from './interchangeShopSigns'
import { MAP_PLACE_SIGNS } from './mapPlaceSigns'

const CYRILLIC = /[А-Яа-яЁё]/

/** The plate's real size in metres: its height, and the text's width at about half a letter height per character. */
function plate(sign: { sign: string; signEn?: string; h: number; font: string; piece?: unknown }, text: string) {
  const longest = Math.max(...text.split('\n').map((line) => line.length))
  const letter = signThickness(sign) > 1 ? sign.h / 1.8 : sign.h
  return { w: letter * (longest * (sign.font === 'geometric-bold' ? 0.56 : 0.46) + 0.6 + (sign.piece ? 1 : 0)), h: sign.h }
}

describe('signs of shops and rooms on every map', () => {
  it('Streets of Tarkov has its shops on the ground level, and none on the floors above', () => {
    const names = shopSignsOf('streets-of-tarkov', 'Ground_Level').map((sign) => sign.name)
    expect(names).toEqual(expect.arrayContaining(['Kilmov Shopping Mall', 'Lexos', 'Sparja Grocery', 'Shestyorochka', 'Concordia', 'Pinewood Hotel', 'Pharmacy 1', 'Tarbank', 'Burger Spot']))
    expect(shopSignsOf('streets-of-tarkov', 'Second_Floor')).toEqual([])
    expect(shopSignsOf('streets-of-tarkov', undefined)).toEqual([])
  })

  it('a map keeps rooms to their floors', () => {
    expect(shopSignsOf('factory', 'Third_Floor').map((sign) => sign.name)).toContain('Main Office')
    expect(shopSignsOf('factory', 'Ground_Floor').map((sign) => sign.name)).not.toContain('Main Office')
    expect(shopSignsOf('the-lab', 'Основной').map((sign) => sign.name)).toContain('Server Room')
    expect(shopSignsOf('the-lab', '2 уровень').map((sign) => sign.name)).toContain('Cafeteria')
    expect(shopSignsOf('the-lab', 'Технический уровень').map((sign) => sign.name)).toEqual(['Boiler Room'])
  })

  it('Reserve\'s chess buildings carry their piece, on the ground and in the basement (proposal №64)', () => {
    const ground = shopSignsOf('reserve', 'Ground_Level')
    const basement = shopSignsOf('reserve', 'Bunkers')
    const pieces = (signs: typeof ground) => Object.fromEntries(signs.filter((sign) => sign.piece).map((sign) => [sign.name, sign.piece]))
    expect(pieces(ground)).toEqual(pieces(basement))
    expect(Object.keys(pieces(ground))).toHaveLength(9)
    expect(pieces(ground)['White Queen']).toEqual({ kind: 'queen', white: true })
    expect(pieces(ground)['Black Knight']).toEqual({ kind: 'knight', white: false })
    expect(pieces(ground)['Black Bishop']).toEqual({ kind: 'bishop', white: false })
  })

  it('no street names or plain nature', () => {
    const names = Object.values(MAP_PLACE_SIGNS).flat().map((sign) => sign.name)
    for (const name of ['Primorsky Ave.', 'Kilmov St.', 'Ponds', 'Swamp', 'Sniper Rock', 'Dead Tree']) expect(names).not.toContain(name)
  })

  it('every sign has a position, colours and text in both languages, one or two lines', () => {
    for (const [mapId, signs] of Object.entries(MAP_PLACE_SIGNS)) {
      for (const sign of signs) {
        const where = `${mapId}: ${sign.name}`
        expect(sign.sign.trim(), where).not.toBe('')
        expect(Number.isFinite(sign.x) && Number.isFinite(sign.z), where).toBe(true)
        expect(sign.h, where).toBeGreaterThan(0)
        expect(sign.bg, where).toMatch(/^#[0-9a-f]{6}$/)
        expect(sign.fg, where).toMatch(/^#[0-9a-f]{6}$/)
        expect(signLines(sign).length, where).toBeLessThanOrEqual(2)
        const english = sign.signEn ?? sign.sign
        // A Russian word goes with its English; a business shows its own sign in both.
        if (CYRILLIC.test(sign.sign) && !sign.signEn) throw new Error(`${where}: no English`)
        expect(CYRILLIC.test(english), where).toBe(false)
      }
    }
  })

  it('plates of one floor never overlap, in either language', () => {
    const touching = new Set<string>()
    for (const [mapId, signs] of Object.entries(MAP_PLACE_SIGNS)) {
      for (const pick of [(sign: (typeof signs)[number]) => sign.sign, (sign: (typeof signs)[number]) => sign.signEn ?? sign.sign]) {
        for (const a of signs) for (const b of signs) {
          if (a === b || a.floor !== b.floor || a.name > b.name) continue
          const [pa, pb] = [plate(a, pick(a)), plate(b, pick(b))]
          // A map turned a quarter draws x up the screen.
          const turned = mapId === 'factory' || mapId === 'the-lab'
          const [dx, dz] = turned ? [Math.abs(a.z - b.z), Math.abs(a.x - b.x)] : [Math.abs(a.x - b.x), Math.abs(a.z - b.z)]
          if (dx * 2 < pa.w + pb.w && dz * 2 < pa.h + pb.h) touching.add(`${mapId}, ${a.floor}: ${a.name} / ${b.name}`)
        }
      }
    }
    expect([...touching]).toEqual([])
  })
})
