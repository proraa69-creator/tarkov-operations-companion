import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLiveCatalog } from './catalogSource'
import { adaptObjectiveDetails } from './objectiveDetails'
import { adaptObjectiveConditions, hasGearConditions, joinMergedGear } from './objectiveConditions'
import fixture from './__fixtures__/tarkovDevConditionQuests.json'
import { conditionQuestsFetcher } from './__fixtures__/conditionQuestsFeed'

afterEach(() => vi.unstubAllGlobals())

const SLOTS: Record<string, string> = { beanie: 'headwear', helmet: 'headwear', glasses: 'eyewear', armor: 'armorVest', rigA: 'vest', rigB: 'vest' }
const NAMES: Record<string, string> = { ak12: 'АК-12', akm: 'АКМ', ps320: 'Валдай ПС-320', supp: 'Глушитель АК-12', beanie: 'Шапка Bomber', glasses: 'Очки RayBench', helmet: 'Кивер', armor: '6Б43' }
const context = { itemName: (id: string) => NAMES[id], itemSlot: (id: string) => SLOTS[id] }

describe('kill objective conditions (tarkov.dev TaskObjectiveShoot)', () => {
  it('reads weapons, part options, gear options, gear not to wear and every kill condition from the JSON feed shape', () => {
    // json.tarkov.dev after the `_ru` dictionary: the texts are words; `raw` keeps the game's keys.
    const raw = {
      id: 'o', type: 'shoot', count: 5, shotType: 'kill',
      usingWeapon: ['ak12', 'akm'], usingWeaponMods: [['ps320', 'supp']],
      wearing: [[{ id: 'beanie', name: 'Bomber beanie' }], [{ id: 'glasses', name: 'RayBench Hipster Reserve sunglasses' }]],
      notWearing: [{ id: 'helmet', name: 'FORT Kiver-M' }, { id: 'armor', name: '6B43' }],
      distance: { compareMethod: '>=', value: 50 },
      bodyParts: ['QuestCondition/Elimination/Kill/BodyPart/Head'], targetNames: ['AnyPmc'],
      timeFromHour: 21, timeUntilHour: 4,
      enemyHealthEffect: { effects: ['Stun'] }, playerHealthEffect: null,
    }
    const translated = { ...raw, bodyParts: ['голову'], targetNames: ['любых бойцов ЧВК'], enemyHealthEffect: { effects: ['Оглушён'] } }
    expect(adaptObjectiveConditions(translated, context, raw)).toEqual({
      weapons: [{ id: 'ak12', name: 'АК-12' }, { id: 'akm', name: 'АКМ' }],
      // one option: the scope AND the suppressor
      mods: [[{ id: 'ps320', name: 'Валдай ПС-320' }, { id: 'supp', name: 'Глушитель АК-12' }]],
      // two single-item options of different slots are two merged conditions: one outfit of both
      wearing: [[{ id: 'beanie', name: 'Шапка Bomber' }, { id: 'glasses', name: 'Очки RayBench' }]],
      notWearing: [{ id: 'helmet', name: 'Кивер' }, { id: 'armor', name: '6Б43' }],
      distance: { compare: '>=', value: 50 },
      bodyParts: [{ key: 'Head', name: 'голову' }],
      targets: [{ key: 'AnyPmc', name: 'любых бойцов ЧВК' }],
      time: { from: 21, until: 4 },
      enemyEffects: ['Оглушён'],
    })
  })

  it('keeps alternatives: any of the weapons, any of the single-part options, same-slot gear stays «one of»', () => {
    const conditions = adaptObjectiveConditions({
      id: 'o', type: 'shoot', count: 1, usingWeapon: ['ak12'],
      // «any suppressor»: thirty options of one part upstream (here two)
      usingWeaponMods: [['supp'], ['ps320']],
      // «any Goons rig»: options of the same slot
      wearing: [[{ id: 'rigA' }], [{ id: 'rigB' }]],
      distance: { compareMethod: '>=', value: 0 }, bodyParts: [], targetNames: ['Any'], timeFromHour: 0, timeUntilHour: 0,
    }, context)!
    expect(conditions.mods).toEqual([[{ id: 'supp', name: 'Глушитель АК-12' }], [{ id: 'ps320', name: 'Валдай ПС-320' }]])
    expect(conditions.wearing).toEqual([[{ id: 'rigA', name: 'rigA' }], [{ id: 'rigB', name: 'rigB' }]])
    // no distance, no hours, no body parts: nothing made up
    expect(conditions.distance).toBeUndefined()
    expect(conditions.time).toBeUndefined()
    expect(conditions.bodyParts).toBeUndefined()
  })

  it('joins merged single-item gear per slot and leaves the rest alone', () => {
    const ref = (id: string) => ({ id, name: id })
    const slot = (id: string) => SLOTS[id]
    // (beanie | helmet) and glasses → two outfits
    expect(joinMergedGear([[ref('beanie')], [ref('helmet')], [ref('glasses')]], slot)).toEqual([[ref('beanie'), ref('glasses')], [ref('helmet'), ref('glasses')]])
    // a slot unknown: as upstream has it
    expect(joinMergedGear([[ref('beanie')], [ref('mystery')]], slot)).toEqual([[ref('beanie')], [ref('mystery')]])
    // real outfits (Setup: hat + vest) are never joined
    expect(joinMergedGear([[ref('beanie'), ref('rigA')], [ref('helmet'), ref('rigB')]], slot)).toEqual([[ref('beanie'), ref('rigA')], [ref('helmet'), ref('rigB')]])
  })

  it('all seven body parts is any part; a hit-only objective and the player\'s own effects are kept', () => {
    const parts = ['Head', 'Chest', 'Stomach', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'].map((part) => `QuestCondition/Elimination/Kill/BodyPart/${part}`)
    const conditions = adaptObjectiveConditions({ id: 'o', type: 'shoot', shotType: 'hit', bodyParts: parts, playerHealthEffect: { effects: ['Tremor'] }, targetNames: ['Savage'] })!
    expect(conditions).toEqual({ hitOnly: true, playerEffects: ['Tremor'], targets: [{ key: 'Savage', name: 'Savage' }] })
    expect(hasGearConditions(conditions)).toBe(false)
  })

  it('takes the GraphQL shape too (objects everywhere, named zones) and ignores objectives that are not kills', () => {
    const [shoot, visit] = adaptObjectiveDetails([
      { id: 'g', type: 'shoot', count: 2, usingWeapon: [{ id: 'ak12', name: 'AK-12' }], usingWeaponMods: [[{ id: 'supp', name: 'AK-12 suppressor' }]], wearing: [], notWearing: [], zoneNames: ['Мост'], targetNames: ['Scav'] },
      { id: 'v', type: 'visit', description: 'Посетить' },
    ], () => undefined)
    expect(shoot.conditions).toEqual({ weapons: [{ id: 'ak12', name: 'AK-12' }], mods: [[{ id: 'supp', name: 'AK-12 suppressor' }]], zoneNames: ['Мост'], targets: [{ key: 'Scav', name: 'Scav' }] })
    expect(visit.conditions).toBeUndefined()
  })
})

/** json.tarkov.dev answers from the fixture of real regular/* data (src/data/__fixtures__/tarkovDevConditionQuests.json). */
function stubRealFeed() {
  vi.stubGlobal('fetch', vi.fn(conditionQuestsFetcher(fixture as unknown as Record<string, unknown>)))
}
const noWiki = async () => ({ titles: [], pages: [], storyQuests: [] })

const PATRIOT = '64f5deac39e45b527a7c4232'
const AK12 = '6499849fc93611967b034949'
const PS320 = '5c0517910db83400232ffee5'
const AK12_SUPPRESSOR = '64c196ad26a15b84aa07132f'

describe('the catalog keeps the conditions (real tarkov.dev quests)', () => {
  it('«Работа для патриота»: an AK-12 with its suppressor and the PS-320 scope, on the corrected maps, in Russian and English', async () => {
    stubRealFeed()
    const ru = await fetchLiveCatalog('pvp', 'ru', fetch, { wiki: noWiki })
    const patriot = ru.quests.find((quest) => quest.id === PATRIOT)!
    expect(patriot.name).toBe('Работа для патриота')
    const [objective] = patriot.objectiveDetails!
    expect(objective.conditions).toMatchObject({
      weapons: [{ id: AK12, name: expect.stringMatching(/АК-12/) }],
      mods: [[{ id: PS320, name: expect.stringMatching(/ПС-320/) }, { id: AK12_SUPPRESSOR, name: expect.stringMatching(/АК-12/) }]],
      targets: [{ key: 'AnyPmc', name: expect.stringMatching(/ЧВК/) }],
    })
    // the owner's checked maps (src/data/questCorrections.ts) stay with the objective
    expect(objective.mapIds).toEqual(['streets-of-tarkov', 'shoreline', 'ground-zero'])
    expect(objective.count).toBe(10)

    const en = await fetchLiveCatalog('pvp', 'en', fetch)
    const english = en.quests.find((quest) => quest.id === PATRIOT)!.objectiveDetails![0].conditions!
    expect(english.weapons![0].name).toMatch(/AK-12/)
    expect(english.mods![0].map((part) => part.name).join(' ')).toMatch(/PS-320/)
    expect(english.targets).toEqual([{ key: 'AnyPmc', name: 'any PMC operatives' }])
  })

  it('every quest of the fixture has gear conditions; outfits, merged gear and «any of» suppressors keep their shape', async () => {
    stubRealFeed()
    const catalog = await fetchLiveCatalog('pvp', 'ru', fetch, { wiki: noWiki })
    const geared = catalog.quests.filter((quest) => quest.objectiveDetails?.some((objective) => hasGearConditions(objective.conditions)))
    expect(geared).toHaveLength(Object.keys(fixture.tasks.tasks).length)
    const conditionsOf = (name: string) => catalog.quests.find((quest) => quest.name === name)!.objectiveDetails!.flatMap((objective) => objective.conditions ? [objective.conditions] : [])
    // «Стиляги»: a beanie AND sunglasses (two merged upstream conditions) — one outfit of two
    const [dandies] = conditionsOf('Стиляги')
    expect(dandies.wearing).toHaveLength(1)
    expect(dandies.wearing![0]).toHaveLength(2)
    // «Подстава»: nine real outfits of a hat and a vest, and any of the Scav weapons
    const [setup] = conditionsOf('Подстава')
    expect(setup.wearing!.map((outfit) => outfit.length)).toEqual(Array(9).fill(2))
    expect(setup.weapons!.length).toBeGreaterThan(10)
    // «Тарковский стрелок. Часть 6»: any one suppressor (thirty single-part options), on a bolt-action rifle
    const [shooter6] = conditionsOf('Тарковский стрелок. Часть 6')
    expect(shooter6.mods!.length).toBe(30)
    expect(shooter6.mods!.every((option) => option.length === 1)).toBe(true)
    // «Ловкач»: no armor and no helmet (the fixture keeps 24 of the list)
    const [swift] = conditionsOf('Ловкач')
    expect(swift.notWearing).toHaveLength(24)
    // «Стрелок от бога»: headshots, four objectives of two maps each
    const shooterBorn = conditionsOf('Стрелок от бога')
    expect(shooterBorn).toHaveLength(4)
    expect(shooterBorn.every((conditions) => conditions.bodyParts?.[0]?.key === 'Head')).toBe(true)
    // every item has its name in the catalog's language, never a translation key
    for (const conditions of geared.flatMap((quest) => quest.objectiveDetails!.flatMap((objective) => objective.conditions ? [objective.conditions] : []))) {
      for (const ref of [...conditions.weapons ?? [], ...(conditions.mods ?? []).flat(), ...(conditions.wearing ?? []).flat(), ...conditions.notWearing ?? []]) {
        expect(ref.name).not.toMatch(/^[0-9a-f]{24}/)
      }
    }
  })
})
