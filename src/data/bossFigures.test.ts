import { describe, expect, it } from 'vitest'
import { bossFiguresFor, bossMapIds } from './bossFigures'

const keys = (mapId: string, mode?: 'pvp' | 'pve' | 'seasonal') => bossFiguresFor(mapId, mode).map((figure) => figure.key)

describe('raid card boss figures (research list 30.09.2026)', () => {
  it('stands every boss of the list on its map, Goons as the trio', () => {
    expect(keys('customs', 'pvp')).toEqual(['reshala', 'goon-1', 'goon-2', 'goon-3', 'partisan', 'cultist-priest'])
    expect(keys('lighthouse', 'pve')).toEqual(['zryachiy', 'rogue', 'goon-1', 'goon-2', 'goon-3', 'partisan'])
    expect(keys('terminal', 'pvp')).toEqual(['reshala', 'sanitar', 'killa', 'glukhar', 'tagilla', 'black-division', 'ruaf'])
    expect(keys('reserve', 'pve')).toEqual(['glukhar', 'raiders'])
  })

  it('shows Black Division patrols only in Season on Shoreline, Streets and Ground Zero', () => {
    expect(keys('shoreline', 'pvp')).not.toContain('black-division')
    expect(keys('shoreline', 'seasonal')).toEqual(['sanitar', 'goon-1', 'goon-2', 'goon-3', 'partisan', 'cultist-priest', 'black-division'])
    expect(keys('streets-of-tarkov', 'pve')).toEqual(['kaban', 'kollontay'])
    expect(keys('ground-zero', 'pvp')).toEqual(['cultist-priest'])
    expect(keys('ground-zero', 'seasonal')).toEqual(['cultist-priest', 'black-division'])
    // Without a mode: the union (the Gallery's «on maps» line).
    expect(bossMapIds('black-division')).toEqual(expect.arrayContaining(['shoreline', 'streets-of-tarkov', 'ground-zero', 'terminal']))
  })

  it('stands the Cultist Priest on his night maps (owner, 19.10.2026)', () => {
    expect(bossMapIds('cultist-priest').sort()).toEqual(['customs', 'factory', 'ground-zero', 'shoreline', 'woods'])
  })

  it('uses the closest existing still for bosses without their own figure, under their own name', () => {
    const vengeful = bossFiguresFor('the-labyrinth', 'pvp').find((figure) => figure.key === 'killa-vengeful')
    expect(vengeful?.url).toBe(bossFiguresFor('interchange', 'pvp').find((figure) => figure.key === 'killa')?.url)
    expect(bossMapIds('military')).toEqual(['terminal'])
    const ruaf = bossFiguresFor('terminal', 'pve').find((figure) => figure.key === 'ruaf')
    expect([ruaf?.name.ru, ruaf?.name.en]).toEqual(['ВС РФ', 'RUAF'])
  })

  it('stands the Raiders as their own model on Reserve and in the Lab (owner, 11.10.2026: «рейдера в боссы»)', () => {
    const raiders = bossFiguresFor('the-lab', 'pvp').find((figure) => figure.key === 'raiders')!
    expect([raiders.key, raiders.name.ru]).toEqual(['raiders', 'Рейдеры'])
    expect(raiders.url).not.toBe(bossFiguresFor('terminal', 'pve').find((figure) => figure.key === 'ruaf')?.url)
    expect(bossMapIds('raiders')).toEqual(['reserve', 'the-lab'])
  })

  it('never stands more than seven figures on the card (Terminal: five bosses, Black Division and the RUAF)', () => {
    expect(bossFiguresFor('terminal', 'pvp')).toHaveLength(7)
    for (const mapId of ['customs', 'woods', 'shoreline', 'interchange', 'factory', 'reserve', 'lighthouse', 'streets-of-tarkov', 'ground-zero', 'icebreaker', 'the-lab', 'the-labyrinth', 'terminal']) {
      for (const mode of ['pvp', 'pve', 'seasonal'] as const) expect(bossFiguresFor(mapId, mode).length, `${mapId} ${mode}`).toBeLessThanOrEqual(7)
    }
  })

  it('follows the owner\'s list of a map (owner, 20.10.2026: «в админке редактирование боссов в блоке карта»); the other maps keep the built-in one', () => {
    const own = {
      shoreline: [{ key: 'black-division', modes: ['pvp', 'pve', 'seasonal'] as const }, { key: 'wadge', modes: ['pve'] as const }].map((entry) => ({ ...entry, modes: [...entry.modes] })),
      factory: [],
    }
    const ownKeys = (mapId: string, mode?: 'pvp' | 'pve' | 'seasonal') => bossFiguresFor(mapId, mode, own).map((figure) => figure.key)
    expect(ownKeys('shoreline', 'pvp')).toEqual(['black-division'])
    expect(ownKeys('shoreline', 'pve')).toEqual(['black-division', 'wadge'])
    expect(ownKeys('factory', 'pvp')).toEqual([])
    expect(ownKeys('customs', 'pvp')).toEqual(keys('customs', 'pvp'))
    expect(bossMapIds('wadge', own)).toEqual(['shoreline', 'icebreaker'])
    expect(bossMapIds('tagilla', own)).not.toContain('factory')
    expect(bossMapIds('sanitar', own)).not.toContain('shoreline')
  })
})
