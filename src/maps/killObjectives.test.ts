import { describe, expect, it } from 'vitest'
import type { Item, MapMarker, ModeProgress, Quest, QuestObjective } from '../domain/types'
import {
  killKind, killMapsTag, killProgress, killRows, killSummary, killTags, killTargetText, killZones, killZoneStyle, movesToKills,
  optionsTag, weaponClassOf, weaponTag, zonePhrase,
} from './killObjectives'

const item = (id: string, name: string, shortName: string, extra: Partial<Item> = {}): Item => ({ id, name, shortName, category: 'Оружие', description: '', prices: [], ...extra })
const items = new Map<string, Item>([
  item('m700', 'Снайперская винтовка Remington Model 700 7.62x51', 'M700', { normalizedName: 'remington-model-700-762x51-bolt-action-sniper-rifle', caliber: 'Caliber762x51' }),
  item('mosin', 'Винтовка Мосина 1891г. 7.62x54R (Снайперская)', 'Мосина', { normalizedName: 'mosin-762x54r-bolt-action-rifle-sniper', caliber: 'Caliber762x54R' }),
  item('mp18', 'Однозарядное ружьё МР-18 7.62x54R', 'МР-18', { normalizedName: 'mp-18-762x54r-single-shot-rifle', caliber: 'Caliber762x54R' }),
  item('akm', 'Автомат Калашникова АКМ 7.62x39', 'АКМ', { normalizedName: 'kalashnikov-akm-762x39-assault-rifle', caliber: 'Caliber762x39' }),
  item('vepr', 'Карабин Вепрь КМ / ВПО-136 7.62x39', 'ВПО-136', { normalizedName: 'molot-arms-vpo-136-vepr-km-762x39-carbine', caliber: 'Caliber762x39' }),
  item('mp133', 'Помповое ружьё МР-133 12к', 'МР-133', { normalizedName: 'mp-133-12ga-pump-action-shotgun', caliber: 'Caliber12g' }),
  item('ppsh', 'Пистолет-пулемёт ППШ-41 7.62x25', 'ППШ-41', { normalizedName: 'ppsh-41-762x25-submachine-gun', caliber: 'Caliber762x25TT' }),
  item('ak12', 'Автомат Калашникова АК-12 5.45x39', 'АК-12', { normalizedName: 'kalashnikov-ak-12-545x39-assault-rifle', caliber: 'Caliber545x39' }),
  item('ak12-can', 'Глушитель 5.45x39 для АК-12', 'АК-12', { category: 'Бартер' }),
  item('ps320', 'Оптический прицел Валдай ПС-320 1x/6x', 'ПС-320', { category: 'Бартер' }),
  item('ushanka', 'Шапка-ушанка', 'Ушанка', { category: 'Бартер' }),
  item('scav-vest', 'Жилет Дикого', 'Жилет Дикого', { category: 'Бартер' }),
  item('zhpc', 'Чехол для бронеплит Tac-Kek «ЖПЦ» облегчённый', 'ЖПЦ', { category: 'Бартер' }),
].map((entry) => [entry.id, entry]))
const ref = (id: string) => ({ id, name: items.get(id)?.name ?? id })

const SCAVS = [{ key: 'Savage', name: 'Диких' }, { key: 'assaultGroup', name: 'Диких' }, { key: 'Marksman', name: 'снайперов' }]
const PMCS = [{ key: 'AnyPmc', name: 'любых бойцов ЧВК' }]
const ANY = [{ key: 'Any', name: 'Любая локация' }]

const shoot = (id: string, extra: Partial<QuestObjective> = {}): QuestObjective => ({ id, type: 'shoot', description: 'Устранить', count: 10, mapIds: ['shoreline'], ...extra })
const quest = (id: string, objectives: QuestObjective[], extra: Partial<Quest> = {}): Quest => ({
  id, name: id, trader: 'Прапор', level: 10, kappa: false, description: '', objectives: objectives.map((objective) => objective.description), rewards: [], objectiveDetails: objectives, mapIds: ['shoreline'], ...extra,
})
const progress = (extra: Partial<ModeProgress> = {}) => ({ taskProgress: {}, objectiveProgress: {}, ...extra }) as Pick<ModeProgress, 'taskProgress' | 'objectiveProgress'>
const zone = (questId: string, objectiveId: string, extra: Partial<MapMarker> = {}): MapMarker => ({
  id: `shoreline-quest-zone-${questId}-${objectiveId}`, mapId: 'shoreline', type: 'quest', layerId: 'quest.zone', title: questId, description: '', position: [0, 0], questId, objectiveId,
  outline: [[-364, -751], [137, -737], [129, -432], [-372, -445]], source: 'json.tarkov.dev/tasks', ...extra,
})
const SMUGGLERS = 'Устранить любую цель в окрестностях баз контрабандистов на локации Берег или Развязка'

describe('«Устранения»: who is to be killed', () => {
  it('sums Scavs with their snipers, PMCs of any side, and everyone else apart', () => {
    expect(killKind(SCAVS)).toBe('scav')
    expect(killKind([{ key: 'Marksman', name: 'снайперов' }])).toBe('scav')
    expect(killKind(PMCS)).toBe('pmc')
    expect(killKind([{ key: 'Usec', name: 'USEC' }, { key: 'Bear', name: 'BEAR' }])).toBe('pmc')
    expect(killKind(ANY)).toBe('other')
    expect(killKind([{ key: 'bossSanitar', name: 'Санитар' }])).toBe('other')
    expect(killKind(undefined)).toBe('other')
  })

  it('names the targets in a word: Scavs, PMCs, any target, a boss, a group of bosses', () => {
    expect(killTargetText(SCAVS)).toBe('Дикие')
    expect(killTargetText(PMCS)).toBe('ЧВК')
    expect(killTargetText(ANY)).toBe('любые цели')
    expect(killTargetText([{ key: 'Marksman', name: 'снайперов' }])).toBe('снайперы')
    expect(killTargetText([{ key: 'bossSanitar', name: 'Санитар' }])).toBe('Санитар')
    expect(killTargetText(['bossBully', 'bossKilla', 'bossGluhar', 'bossSanitar'].map((key) => ({ key, name: key })))).toBe('боссы')
    expect(killTargetText(['ExUsec', 'exUsecFree', 'bossKnight', 'followerBigPipe', 'followerBirdEye'].map((key) => ({ key, name: key })))).toBe('отступники')
    expect(killTargetText(['bossBully', 'followerBully', 'bossKilla'].map((key) => ({ key, name: key })))).toBe('боссы и охрана')
  })
})

describe('«Устранения»: the conditions in short words', () => {
  it('a weapon by its short name; many by their common class; else by their calibre; else an example and «+N»', () => {
    expect(weaponTag([ref('ak12')], items)).toMatchObject({ kind: 'weapon', text: 'АК-12' })
    // «Стрелок от бога»: bolt-action rifles, the single-shot ones among them
    expect(weaponTag([ref('m700'), ref('mosin'), ref('mp18')], items)).toMatchObject({ text: 'болтовая винтовка', names: [items.get('m700')!.name, items.get('mosin')!.name, items.get('mp18')!.name] })
    // «Каратель. Часть 2»: AKM rifles and a carbine of one calibre
    expect(weaponTag([ref('akm'), ref('vepr'), ref('akm')], items)?.text).toBe('АКМ / ВПО-136')
    expect(weaponTag([ref('akm'), ref('vepr'), ref('ak12')].slice(0, 2).concat([{ id: 'akm2', name: 'АКМН' }]), new Map([...items, ['akm2', item('akm2', 'Автомат АКМН 7.62x39', 'АКМН', { normalizedName: 'akmn-762x39-assault-rifle', caliber: 'Caliber762x39' })]]))?.text).toBe('калибр 7.62x39')
    // «Подстава»: shotguns, rifles and an SMG — no class, no calibre in common
    expect(weaponTag([ref('mp133'), ref('mosin'), ref('ppsh')], items)?.text).toBe('МР-133 +2')
    expect(weaponTag(undefined, items)).toBeUndefined()
  })

  it('knows the weapon classes from the tarkov.dev names', () => {
    expect(weaponClassOf({ normalizedName: 'gp-25-kostyor-40mm-underbarrel-grenade-launcher' })).toBe('гранатомёт')
    expect(weaponClassOf({ normalizedName: 'rgd-5-hand-grenade' })).toBe('граната')
    expect(weaponClassOf({ normalizedName: 'hk-mp5-9x19-submachine-gun' })).toBe('пистолет-пулемёт')
    expect(weaponClassOf({ normalizedName: 'stechkin-aps-9x18pm-machine-pistol' })).toBe('пистолет')
    expect(weaponClassOf({ normalizedName: 'pkm-762x54r-machine-gun' })).toBe('пулемёт')
    expect(weaponClassOf({ normalizedName: 'cultist-knife' })).toBe('холодное оружие')
    expect(weaponClassOf({ normalizedName: 'svds-762x54r-sniper-rifle' })).toBe('снайперская винтовка')
    expect(weaponClassOf(undefined)).toBeUndefined()
  })

  it('gear: the item every option shares, one example of the rest and «+N»; a part named like the weapon by its kind', () => {
    const gear = [[ref('ushanka'), ref('scav-vest')], [ref('ushanka'), ref('zhpc')], [ref('ushanka'), { id: 'x', name: 'Ещё жилет' }]]
    expect(optionsTag('gear', gear, items)).toMatchObject({ kind: 'gear', text: 'Ушанка + Жилет Дикого +2', names: ['Шапка-ушанка + Жилет Дикого', 'Шапка-ушанка + Чехол для бронеплит Tac-Kek «ЖПЦ» облегчённый', 'Шапка-ушанка + Ещё жилет'] })
    expect(optionsTag('gear', [[ref('ushanka')]], items)?.text).toBe('Ушанка')
    // «Работа для патриота»: the AK-12's own suppressor is «АК-12» in the game, beside the AK-12 itself
    const tags = killTags({ description: '', conditions: { weapons: [ref('ak12')], mods: [[ref('ps320'), ref('ak12-can')]], targets: PMCS } }, items)
    expect(tags.map((tag) => [tag.kind, tag.text])).toEqual([['weapon', 'АК-12'], ['mods', 'ПС-320 + глушитель']])
  })

  it('takes the zone\'s name from the objective\'s text, Russian or English', () => {
    expect(zonePhrase(SMUGGLERS)).toBe('в окрестностях баз контрабандистов')
    expect(zonePhrase('Устранить бойцов ЧВК на базах Диких на локации Таможня, Берег или Лес')).toBe('на базах Диких')
    expect(zonePhrase('Убить любую цель на территории торгового центра ULTRA, используя АШ-12 на локации Развязка')).toBe('на территории торгового центра ULTRA')
    expect(zonePhrase('Устранить Рейдеров в подземном штабе Резерва')).toBe('в подземном штабе Резерва')
    expect(zonePhrase('Eliminate any target at the smuggler bases on Shoreline or Interchange')).toBe('at the smuggler bases')
    expect(zonePhrase('Eliminate PMC operatives in the Dorms area on Customs')).toBe('in the Dorms area')
    expect(zonePhrase('Устранить Диких')).toBeUndefined()
  })

  it('lists every condition in order: weapon, parts, gear, body part, distance, hit, hours, zone, effects', () => {
    const tags = killTags({
      description: SMUGGLERS,
      conditions: {
        weapons: [ref('ak12')], wearing: [[ref('ushanka')]], bodyParts: [{ key: 'Head', name: 'Голова' }], distance: { compare: '>=', value: 50 },
        hitOnly: true, time: { from: 21, until: 6 }, enemyEffects: ['Оглушён'], playerEffects: ['Боль'], notWearing: [ref('zhpc')],
      },
    }, items, true)
    expect(tags.map((tag) => [tag.kind, tag.text])).toEqual([
      ['weapon', 'АК-12'], ['gear', 'Ушанка'], ['part', 'голова'], ['distance', '50+ м'], ['hit', 'попадание'], ['time', '21:00–06:00'],
      ['zone', 'в окрестностях баз контрабандистов'], ['enemy', 'Оглушён'], ['player', 'Боль'],
    ])
    // Gear not to wear is nothing to take and is not shown (owner, 15.10.2026); a zone without words in the text is still named.
    expect(killTags({ description: 'Устранить', conditions: { notWearing: [ref('zhpc')] } }, items, true)).toEqual([{ kind: 'zone', text: 'в зоне задания' }])
  })

  it('says where else a kill counts: any map, other maps, nothing when only this one', () => {
    expect(killMapsTag({ mapIds: [] }, 'shoreline')).toEqual({ kind: 'maps', text: 'Любая карта' })
    expect(killMapsTag({}, 'shoreline')?.text).toBe('Любая карта')
    expect(killMapsTag({ mapIds: ['shoreline'] }, 'shoreline')).toBeUndefined()
    expect(killMapsTag({ mapIds: ['shoreline', 'interchange'] }, 'shoreline', (id) => ({ shoreline: 'Берег', interchange: 'Развязка' })[id] ?? id)?.text).toBe('Берег, Развязка')
  })
})

describe('«Устранения»: the list, its summary and the zones', () => {
  const smugglers = quest('smugglers', [shoot('kill-any', { description: SMUGGLERS, conditions: { targets: ANY }, mapIds: ['shoreline', 'interchange'], zones: [{ mapId: 'shoreline', position: { x: -591, z: -117 } }] })])
  const outposts = quest('outposts', [shoot('kill-pmc', { count: 12, conditions: { targets: PMCS }, mapIds: ['customs', 'shoreline', 'woods'] })])
  const punisher = quest('punisher', [shoot('kill-scav', { count: 15, conditions: { targets: SCAVS, weapons: [ref('akm')] } })], { level: 3 })
  const sharpshooter = quest('sharpshooter', [shoot('kill-head', { count: 5, mapIds: [], conditions: { targets: PMCS, bodyParts: [{ key: 'Head', name: 'Голова' }] } })], { anyMap: true, mapIds: [] })
  const elsewhere = quest('elsewhere', [shoot('kill-woods', { mapIds: ['woods'], conditions: { targets: SCAVS } })])
  const chapter = quest('chapter', [shoot('kill-chapter', { conditions: { targets: SCAVS } })], { kind: 'story' })
  const points = [zone('smugglers', 'kill-any'), zone('outposts', 'kill-pmc', { outline: [[-204, -70], [-193, -450], [5, -444], [-5, -64]] })]
  const input = { mapId: 'shoreline', items, points, mapName: (id: string) => ({ shoreline: 'Берег', interchange: 'Развязка', customs: 'Таможня', woods: 'Лес' })[id] ?? id }

  it('one row per kill of the current quests here: Scavs, PMCs, then the rest; another map\'s kill and story chapters left out', () => {
    const rows = killRows({ ...input, quests: [smugglers, outposts, punisher, sharpshooter, elsewhere, chapter], progress: progress() })
    expect(rows.map((row) => [row.key, row.kind, row.target, row.left])).toEqual([
      ['punisher:kill-scav', 'scav', 'Дикие', 15],
      ['outposts:kill-pmc', 'pmc', 'ЧВК', 12],
      ['sharpshooter:kill-head', 'pmc', 'ЧВК', 5],
      ['smugglers:kill-any', 'other', 'любые цели', 10],
    ])
    expect(rows[0].tags.map((tag) => tag.text)).toEqual(['АКМ'])
    expect(rows[2].tags.map((tag) => tag.text)).toEqual(['голова', 'Любая карта'])
    expect(rows[3].tags.map((tag) => tag.text)).toEqual(['в окрестностях баз контрабандистов', 'Берег, Развязка'])
    expect(rows[3].zones).toHaveLength(1)
    expect(rows[3].marker?.id).toBe(points[0].id)
  })

  it('counts what is left from the game\'s log; a done kill and a quest checked for this raid go last, out of the summary and the map', () => {
    const counted = progress({ objectiveProgress: { 'kill-any': { objectiveId: 'kill-any', taskId: 'smugglers', type: 'shoot', target: 10, current: 3, source: 'log', confidence: 0.95, observedAt: '2026-11-08T00:00:00Z' } } })
    expect(killProgress(counted, 'smugglers', smugglers.objectiveDetails![0])).toEqual({ total: 10, current: 3, left: 7 })
    const done = progress({ objectiveProgress: { 'kill-pmc': { objectiveId: 'kill-pmc', taskId: 'outposts', type: 'shoot', target: 12, current: 12, source: 'manual', confidence: 1, observedAt: '2026-11-08T00:00:00Z' } } })
    const rows = killRows({ ...input, quests: [smugglers, outposts, punisher], progress: done, checked: new Map([['punisher', 1]]) })
    expect(rows.map((row) => [row.key, row.settled])).toEqual([['smugglers:kill-any', false], ['punisher:kill-scav', true], ['outposts:kill-pmc', true]])
    expect(killSummary(rows)).toEqual({ scav: 0, pmc: 0, other: 10 })
    expect(killZones(rows).map((entry) => entry.questId)).toEqual(['smugglers'])
  })

  it('sums the open kills by Scavs, PMCs and other targets', () => {
    const rows = killRows({ ...input, quests: [smugglers, outposts, punisher, sharpshooter], progress: progress() })
    expect(killSummary(rows)).toEqual({ scav: 15, pmc: 17, other: 10 })
  })

  it('draws the zones from the quest\'s points (moved by the constructor), else from the feed; PMC zones green, every other orange', () => {
    const rows = killRows({ ...input, quests: [smugglers, outposts], progress: progress() })
    expect(killZones(rows).map((entry) => [entry.questId, entry.kind, entry.positions[0]])).toEqual([['outposts', 'pmc', [-204, -70]], ['smugglers', 'scav', [-364, -751]]])
    const fromFeed = quest('feed', [shoot('kill-feed', { conditions: { targets: SCAVS }, zones: [{ mapId: 'shoreline', position: { x: 0, z: 0 }, outline: [{ x: 1, z: 2 }, { x: 3, z: 4 }, { x: 5, z: 6 }] }, { mapId: 'woods', position: { x: 0, z: 0 }, outline: [{ x: 1, z: 2 }, { x: 3, z: 4 }, { x: 5, z: 6 }] }] })])
    expect(killRows({ ...input, quests: [fromFeed], progress: progress() })[0].zones).toEqual([[[2, 1], [4, 3], [6, 5]]])
  })

  it('looks like the minefields\' dashes, fainter: orange-yellow for Scavs, green for PMCs, the chosen quest a little stronger', () => {
    const scav = killZoneStyle('scav')
    const pmc = killZoneStyle('pmc')
    expect(scav.dashArray).toBeTruthy()
    expect(scav.color).toBe('#e3a541')
    expect(pmc.color).toBe('#5fc777')
    // the scheme's minefields: fill-opacity .4 and a solid red line
    expect(scav.fillOpacity).toBeLessThan(0.4)
    expect(scav.opacity).toBeLessThan(1)
    expect(killZoneStyle('scav', true).fillOpacity).toBeGreaterThan(scav.fillOpacity)
  })
})

describe('«Актуальные квесты» or «Устранения»: the rule', () => {
  const visit = (id: string, extra: Partial<QuestObjective> = {}): QuestObjective => ({ id, type: 'visit', description: 'Посетить', count: 1, mapIds: ['shoreline'], zoneBound: true, ...extra })
  const point = (questId: string, objectiveId?: string): MapMarker => ({ id: `p-${questId}-${objectiveId}`, mapId: 'shoreline', type: 'quest', layerId: 'quest.zone', title: questId, description: '', position: [1, 1], questId, ...(objectiveId ? { objectiveId } : {}), source: 'json.tarkov.dev/tasks' })

  it('a quest that only asks to kill here goes to «Устранения», its kill zone points with it', () => {
    expect(movesToKills(quest('q', [shoot('k')]), 'shoreline', progress(), [])).toBe(true)
    expect(movesToKills(quest('q', [shoot('k')]), 'shoreline', progress(), [point('q', 'k')])).toBe(true)
    // kill and extract: nothing to find, no place to go
    expect(movesToKills(quest('q', [shoot('k'), { id: 'e', type: 'extract', description: 'Выжить', count: 1, mapIds: ['shoreline'] }]), 'shoreline', progress(), [])).toBe(true)
    // kill here and hand over at the trader
    expect(movesToKills(quest('q', [shoot('k'), { id: 'g', type: 'giveItem', description: 'Передать', count: 1 }]), 'shoreline', progress(), [])).toBe(true)
    // any map
    expect(movesToKills(quest('q', [shoot('k', { mapIds: [] })], { anyMap: true }), 'customs', progress(), [])).toBe(true)
  })

  it('a quest with a place to go here, or something to find in the raid, stays in «Актуальные квесты»', () => {
    expect(movesToKills(quest('q', [shoot('k'), visit('v')]), 'shoreline', progress(), [])).toBe(false)
    expect(movesToKills(quest('q', [shoot('k')]), 'shoreline', progress(), [point('q', 'plant')])).toBe(false)
    // a point the quest constructor added, of no objective
    expect(movesToKills(quest('q', [shoot('k')]), 'shoreline', progress(), [point('q')])).toBe(false)
    expect(movesToKills(quest('q', [shoot('k'), { id: 'f', type: 'findItem', description: 'Найти в рейде', count: 3, foundInRaid: true }]), 'shoreline', progress(), [])).toBe(false)
  })

  it('a place already ticked no longer holds it; another map\'s place never did; no kill here, a story chapter: they stay', () => {
    const ticked = progress({ objectiveProgress: { v: { objectiveId: 'v', taskId: 'q', type: 'visit', target: 1, current: 1, source: 'manual', confidence: 1, observedAt: '2026-11-08T00:00:00Z' } } })
    expect(movesToKills(quest('q', [shoot('k'), visit('v')]), 'shoreline', ticked, [point('q', 'v')])).toBe(true)
    expect(movesToKills(quest('q', [shoot('k'), visit('v', { mapIds: ['streets-of-tarkov'] })]), 'shoreline', progress(), [])).toBe(true)
    expect(movesToKills(quest('q', [visit('v')]), 'shoreline', progress(), [])).toBe(false)
    expect(movesToKills(quest('q', [shoot('k', { mapIds: ['woods'] })]), 'shoreline', progress(), [])).toBe(false)
    expect(movesToKills(quest('q', [shoot('k')], { kind: 'story' }), 'shoreline', progress(), [])).toBe(false)
  })
})
