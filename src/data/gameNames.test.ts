import { afterEach, describe, expect, it } from 'vitest'
import { gameExitName, gameItemNames, gameNames, gameNamesVersion, gameQuestTitle, resetGameNamesForTests, setGameNames, setWantedGameLanguage } from './gameNames'
import { gameNamesFromDictionaries } from './gameNamesLoader'
import { exitNames } from './exitShortNames'

afterEach(() => resetGameNamesForTests())

/** Pieces of tarkov.dev's dictionaries (regular/{tasks,items,maps}_{de,en,ru}), as the loader gets them. */
const DICTIONARIES = {
  tasks: { '5936d90786f7742b1420ba5b name': 'Debüt', '5936d90786f7742b1420ba5b description': 'Prapor …' },
  items: { '57347ca924597744596b4e71 Name': 'Grafikkarte', '57347ca924597744596b4e71 ShortName': 'GPU', '57347ca924597744596b4e71 Description': '…' },
  maps: { '56f40101d2720b2a4d8b45d6 Name': 'Customs', 'ex_customs_pmc_trailerpark': 'Wohnwagenpark', 'tr_customs_factory_DESC': 'Transit zu Factory' },
  mapsEn: { '56f40101d2720b2a4d8b45d6 Name': 'Customs', 'ex_customs_pmc_trailerpark': 'Trailer Park', 'tr_customs_factory_DESC': 'Transit to Factory' },
  mapsRu: { '56f40101d2720b2a4d8b45d6 Name': 'Таможня', 'ex_customs_pmc_trailerpark': 'Трейлерный парк', 'tr_customs_factory_DESC': 'Переход на Завод' },
}

describe('the game\'s names in its language', () => {
  it('come from tarkov.dev\'s dictionaries: quests, items, exits and transits by their Russian and English names', () => {
    const names = gameNamesFromDictionaries('de', DICTIONARIES)
    expect([...names.quests]).toEqual([['5936d90786f7742b1420ba5b', 'Debüt']])
    expect(names.items.get('57347ca924597744596b4e71')).toEqual({ name: 'Grafikkarte', shortName: 'GPU' })
    expect(names.exits.get('trailer park')).toBe('Wohnwagenpark')
    expect(names.exits.get('трейлерный парк')).toBe('Wohnwagenpark')
    expect(names.exits.get('переход на завод')).toBe('Transit zu Factory')
    // Map names are no exits.
    expect(names.exits.has('customs')).toBe(false)
  })

  it('are kept only for the language the game runs in, and dropped for a Russian or English game', () => {
    const names = gameNamesFromDictionaries('de', DICTIONARIES)
    const before = gameNamesVersion()
    setGameNames(names)
    expect(gameNames()).toBeNull()
    setWantedGameLanguage('de')
    setGameNames(names)
    expect(gameNamesVersion()).toBeGreaterThan(before)
    expect(gameQuestTitle('5936d90786f7742b1420ba5b')).toBe('Debüt')
    expect(gameItemNames('57347ca924597744596b4e71')?.shortName).toBe('GPU')
    expect(gameExitName('Трейлерный  парк')).toBe('Wohnwagenpark')
    expect(exitNames('Трейлерный парк')).toContain('Wohnwagenpark')
    setWantedGameLanguage('ru')
    expect(gameNames()).toBeNull()
    expect(exitNames('Трейлерный парк')).not.toContain('Wohnwagenpark')
  })
})
