import { describe, expect, it } from 'vitest'
import {
  applySimilarityTransform,
  fitRobustSimilarity,
  matchLandmarkPairs,
  scoreLandmarkName,
} from './wikiCoordTransform'

const shorelineWiki = [
  { title: 'Разрушенная дорога', categoryId: 'exfil_scav', position: [597.75, 974] as [number, number] },
  { title: 'Тоннель', categoryId: 'exfil_pmc', position: [526.6177752886813, 1035.7346577429955] as [number, number] },
  { title: 'Переход на Маяк', categoryId: 'exfil_pmc', position: [379.716341497176, 2796.607319592795] as [number, number] },
  { title: 'Бункер в горе', categoryId: 'exfil_pmc', position: [3125.8920503987356, 3330.38455104099] as [number, number] },
  { title: 'Дорога На Таможню', categoryId: 'exfil_scav', position: [4732.25, 2044] as [number, number] },
  { title: 'ЖД-мост ', categoryId: 'exfil_pmc', position: [5281.380548682323, 1059.5995116080414] as [number, number] },
  { title: 'Маяк', categoryId: 'exfil_scav', position: [3368.303152182119, 186.67619023324855] as [number, number] },
  { title: 'Лодка на причале', categoryId: 'exfil_pmc', position: [2946.513957204343, 183.84776310850233] as [number, number] },
  { title: 'Подвал в адм. корпусе', categoryId: 'exfil_scav', position: [4495.077808002882, 3674.1268350453006] as [number, number] },
  { title: 'Тропа альпиниста', categoryId: 'exfil_pmc', position: [2494.5, 3244.5] as [number, number] },
  { title: 'Путь контрабандиста (Совм.)', categoryId: 'exfil_pmc', position: [4186, 2882] as [number, number] },
  { title: 'А-Выход дорога на север', categoryId: 'exfil_pmc', position: [3630.2862146117345, 3299.537017711727] as [number, number] },
  { title: 'Вход в спортзал восточного крыла', categoryId: 'exfil_scav', position: [5513.223184563863, 470.756339574944] as [number, number] },
]

const shorelineGame = [
  { name: 'А-Выход дорога на север', x: -543.264038, z: -379.651367 },
  { name: 'Дорога На Таможню', x: -859.05, z: 0.49 },
  { name: 'ЖД-мост', x: -1029.29, z: 307.59 },
  { name: 'Тоннель', x: 376.36, z: 319.25 },
  { name: 'Переход на Маяк', x: 448.9, z: -254.6 },
  { name: 'Маяк', x: -458.1507, z: 567.2876 },
  { name: 'Разрушенная дорога', x: 366.62, z: 332.51 },
  { name: 'Вход в спортзал восточного крыла', x: -296.9457, z: -100.892 },
  { name: 'Подвал в адм. корпусе', x: -256.87, z: -149.782379 },
  { name: 'Путь контрабандиста (Совм.)', x: -729.4, z: -255.1 },
  { name: 'Лодка на причале', x: -332.5907, z: 561.2576 },
  { name: 'Тропа альпиниста', x: -214.3, z: -361.8 },
  { name: 'Бункер в горе', x: -390.956024, z: -385.721 },
]

describe('wiki coordinate calibration', () => {
  it('does not confuse Маяк with Переход на Маяк', () => {
    expect(scoreLandmarkName('Маяк', 'Маяк')).toBe(100)
    expect(scoreLandmarkName('Маяк', 'Переход на Маяк')).toBe(0)
    expect(scoreLandmarkName('Переход на Маяк', 'Маяк')).toBe(0)
  })

  it('matches extract names even with trailing spaces', () => {
    const pairs = matchLandmarkPairs(shorelineGame, shorelineWiki)
    expect(pairs.find((pair) => pair.name === 'Тоннель')).toBeTruthy()
    expect(pairs.find((pair) => pair.name === 'ЖД-мост')).toBeTruthy()
    expect(pairs.find((pair) => pair.name === 'Маяк')?.wikiX).toBeCloseTo(3368.3, 0)
  })

  it('places Wet Job Part 2 on the fishermen island near Tunnel', () => {
    const transform = fitRobustSimilarity(matchLandmarkPairs(shorelineGame, shorelineWiki))
    expect(transform).toBeTruthy()
    const [wikiX, wikiY] = applySimilarityTransform(transform!, 235.560059, 442.02002)
    const tunnel = shorelineWiki.find((point) => point.title === 'Тоннель')!.position
    expect(wikiX).toBeGreaterThan(960)
    expect(wikiX).toBeLessThan(1100)
    expect(wikiY).toBeGreaterThan(540)
    expect(wikiY).toBeLessThan(700)
    expect(Math.hypot(wikiX - tunnel[0], wikiY - tunnel[1])).toBeGreaterThan(300)
    expect(Math.hypot(wikiX - tunnel[0], wikiY - tunnel[1])).toBeLessThan(760)
  })
})
