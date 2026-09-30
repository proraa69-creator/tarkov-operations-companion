import { describe, expect, it } from 'vitest'
import { bossFiguresFor, bossMapIds } from './bossFigures'

const keys = (mapId: string, mode?: 'pvp' | 'pve' | 'seasonal') => bossFiguresFor(mapId, mode).map((figure) => figure.key)

describe('raid card boss figures (research list 30.09.2026)', () => {
  it('stands every boss of the list on its map, Goons as the trio', () => {
    expect(keys('customs', 'pvp')).toEqual(['reshala', 'goon-1', 'goon-2', 'goon-3', 'partisan'])
    expect(keys('lighthouse', 'pve')).toEqual(['zryachiy', 'rogue', 'goon-1', 'goon-2', 'goon-3', 'partisan'])
    expect(keys('terminal', 'pvp')).toEqual(['reshala', 'sanitar', 'killa', 'glukhar', 'tagilla', 'black-division'])
    expect(keys('reserve', 'pve')).toEqual(['glukhar', 'raiders'])
  })

  it('shows Black Division patrols only in Season on Shoreline, Streets and Ground Zero', () => {
    expect(keys('shoreline', 'pvp')).not.toContain('black-division')
    expect(keys('shoreline', 'seasonal')).toEqual(['sanitar', 'goon-1', 'goon-2', 'goon-3', 'partisan', 'black-division'])
    expect(keys('streets-of-tarkov', 'pve')).toEqual(['kaban', 'kollontay'])
    expect(keys('ground-zero', 'pvp')).toEqual([])
    expect(keys('ground-zero', 'seasonal')).toEqual(['black-division'])
    // Without a mode: the union (the Gallery's «on maps» line).
    expect(bossMapIds('black-division')).toEqual(expect.arrayContaining(['shoreline', 'streets-of-tarkov', 'ground-zero', 'terminal']))
  })

  it('uses the closest existing still for bosses without their own figure, under their own name', () => {
    const raiders = bossFiguresFor('the-lab', 'pvp')[0]
    expect(raiders.key).toBe('raiders')
    expect(raiders.name.ru).toBe('Рейдеры')
    const vengeful = bossFiguresFor('the-labyrinth', 'pvp').find((figure) => figure.key === 'killa-vengeful')
    expect(vengeful?.url).toBe(bossFiguresFor('interchange', 'pvp').find((figure) => figure.key === 'killa')?.url)
    expect(bossMapIds('military')).toEqual(['reserve', 'the-lab'])
  })

  it('never stands more than six figures on the card', () => {
    for (const mapId of ['customs', 'woods', 'shoreline', 'interchange', 'factory', 'reserve', 'lighthouse', 'streets-of-tarkov', 'ground-zero', 'icebreaker', 'the-lab', 'the-labyrinth', 'terminal']) {
      for (const mode of ['pvp', 'pve', 'seasonal'] as const) expect(bossFiguresFor(mapId, mode).length, `${mapId} ${mode}`).toBeLessThanOrEqual(6)
    }
  })
})
