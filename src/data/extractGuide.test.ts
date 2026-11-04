import { describe, expect, it } from 'vitest'
import guide from './extractGuide.json'
import { extractFloor, extractGuideOf, extractPhotoUrl, type ExtractGuide } from './extractGuide'

const data = guide as unknown as { exits: Record<string, ExtractGuide>; files: Record<string, { file: string; url: string }> }
const LIFT = 'streets-of-tarkov-extract-321358e7c712157a0692f8212c0ce644a85d8d9a'

describe('what the map says about the exits (owner, 04.11.2026)', () => {
  it('«Лифт в стилобате»: the third floor of the Beluga, through the kitchen', () => {
    const lift = extractGuideOf(LIFT)!
    expect(lift.ru).toContain('За барной стойкой на 3-м этаже ресторана «Белуга», проход через кухню')
    expect(lift.en).toContain('through the kitchen')
    expect(extractFloor(LIFT, 'ru')).toBe('3 этаж')
    expect(extractFloor(LIFT, 'en')).toBe('Floor 3')
    expect(lift.photos?.length).toBeGreaterThan(0)
  })

  it('covers the exits of every map, in both languages', () => {
    const exits = Object.entries(data.exits)
    expect(exits.length).toBeGreaterThan(140)
    for (const map of ['factory', 'customs', 'woods', 'lighthouse', 'shoreline', 'reserve', 'interchange', 'streets-of-tarkov', 'the-lab', 'ground-zero', 'the-labyrinth', 'icebreaker']) {
      expect(exits.filter(([id]) => id.startsWith(`${map}-`)).length, map).toBeGreaterThan(0)
    }
    expect(exits.filter(([, exit]) => !exit.ru.trim() || !exit.en.trim() || !/[а-яё]/i.test(exit.ru) || /[а-яё]/i.test(exit.en)).map(([id]) => id)).toEqual([])
    expect(exits.filter(([, exit]) => exit.floor && (!exit.floor.ru || !exit.floor.en)).map(([id]) => id)).toEqual([])
  })

  it('never says where it came from (owner: «Источники где взяли не пиши»)', () => {
    expect(Object.values(data.exits).filter((exit) => /wiki|вики|fandom|tarkov\.dev|источник|source/i.test(`${exit.ru} ${exit.en}`))).toEqual([])
  })

  it('shows places: no icons, no maps, every photo listed with its address, every listed photo used', () => {
    const used = new Set(Object.values(data.exits).flatMap((exit) => exit.photos ?? []))
    expect(Object.keys(data.files).filter((id) => !used.has(id))).toEqual([])
    expect([...used].filter((id) => !data.files[id]?.url)).toEqual([])
    expect(Object.values(data.files).filter((entry) => /icon|map\.png$|signalarea|signalzone|\.wav$/i.test(entry.file))).toEqual([])
    expect(used.size).toBeGreaterThan(130)
  })

  it('takes the pictures from our server only', () => {
    const [id] = Object.keys(data.files)
    expect(extractPhotoUrl(id!, true)).toMatch(/^https:\/\/raidos\.app\/v1\/guide-images\/wiki-[0-9a-f]{16}-t\.(png|jpg|webp)$/)
    expect(extractPhotoUrl(id!, false)).toMatch(/^https:\/\/raidos\.app\/v1\/guide-images\/wiki-[0-9a-f]{16}\.(png|jpg|webp)$/)
    expect(extractPhotoUrl('nothing', true)).toBe('')
  })
})
