import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGameLanguageReader, gameSettingsFile } from './gameLanguage'
import type { GameLanguageSetting } from '../src/import/gameLanguage'

let folder = ''
afterEach(async () => { if (folder) await rm(folder, { recursive: true, force: true }) })

async function setup(language?: string) {
  folder = await mkdtemp(join(tmpdir(), 'raidos-game-language-'))
  const file = join(folder, 'Game.ini')
  if (language) await writeFile(file, JSON.stringify({ Version: 1, Language: language, FieldOfView: 66 }, null, 2))
  return file
}

describe('the game\'s language on this computer', () => {
  it('is read from the game\'s own settings file', async () => {
    const file = await setup('ge')
    const reader = createGameLanguageReader(() => file, () => 'auto')
    expect(await reader.current()).toEqual({ setting: 'auto', detected: 'de', language: 'de', model: 'deu+eng' })
    expect(gameSettingsFile('C:\\Users\\Player\\AppData\\Roaming')).toBe(join('C:\\Users\\Player\\AppData\\Roaming', 'Battlestate Games', 'Escape from Tarkov', 'Settings', 'Game.ini'))
  })

  it('is read again when the file changed (after a few seconds, or at once when asked)', async () => {
    const file = await setup('ru')
    let now = 1_000_000
    const reader = createGameLanguageReader(() => file, () => 'auto', () => now)
    expect((await reader.current()).language).toBe('ru')
    await writeFile(file, JSON.stringify({ Version: 1, Language: 'ch' }))
    await utimes(file, new Date(), new Date(Date.now() + 5000))
    // Within the few seconds the last reading stands.
    now += 1000
    expect((await reader.current()).language).toBe('ru')
    now += 3000
    expect(await reader.current()).toMatchObject({ detected: 'zh', language: 'zh', model: 'chi_sim+eng' })
    await writeFile(file, JSON.stringify({ Version: 1, Language: 'jp' }))
    await utimes(file, new Date(), new Date(Date.now() + 10_000))
    expect((await reader.current(true)).language).toBe('ja')
  })

  it('gives way to the player\'s choice, and reads as before without a file', async () => {
    const file = await setup()
    let setting: GameLanguageSetting = 'auto'
    const reader = createGameLanguageReader(() => file, () => setting)
    expect(await reader.current()).toEqual({ setting: 'auto', detected: null, language: 'ru', model: 'rus+eng' })
    setting = 'ja'
    expect(await reader.current()).toMatchObject({ setting: 'ja', language: 'ja', model: 'jpn+eng' })
  })
})
