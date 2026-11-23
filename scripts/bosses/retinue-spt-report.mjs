// What the offline copy (SPT 4.1.6, client 0.16.9) says of each boss's retinue next to what the app shows (the live game's data,
// src/data/bossRetinue.json): how many on each map, guns, rounds, helmets, armour, rigs, plates and the dear loot. For the owner,
// in Russian (task of 20.11.2026: «все расхождения с tarkov.dev надо показать владельцу, а не перезаписывать молча»).
//   node scripts/bosses/retinue-spt-report.mjs [--spt=<SPT database>] <folder with maps.json maps_pve.json items.json
//   items_pve.json items_ru.json> [out.md]
// The dear loot: the share of bots that carry it (live) or SPT's own estimate (spt-bots.mjs sptLoot), at least 1 %, and only
// tier S and A of its category by price per slot as «Тир-листы» rank them (src/screen/tierLists.ts), each mode by its own prices.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSpt, sptEscorts, sptGear, sptLoot } from './spt-bots.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
const SPT = args.find((arg) => arg.startsWith('--spt='))?.slice('--spt='.length) ?? 'E:/SPT/SPT_Runtime/SPT_Data/database'
const [folder, outFile] = args.filter((arg) => !arg.startsWith('--'))
if (!folder) throw new Error('usage: retinue-spt-report.mjs <folder> [out.md]')
const json = async (path) => { const value = JSON.parse(await readFile(path, 'utf8')); return value.data ?? value }
const [maps, pveMaps, pvpItems, pveItems, ru, retinue] = await Promise.all([
  json(join(folder, 'maps.json')), json(join(folder, 'maps_pve.json')), json(join(folder, 'items.json')), json(join(folder, 'items_pve.json')),
  json(join(folder, 'items_ru.json')), json(join(root, 'src/data/bossRetinue.json')),
])
const bossGear = await json(join(root, 'src/data/bossGear.json'))
const spt = await loadSpt(SPT)
if (!spt) throw new Error(`no SPT database at ${SPT}`)
const items = pvpItems.items
const name = (id) => ru[`${id} ShortName`] || ru[`${id} Name`] || spt.ru[`${id} ShortName`] || id
const live = { name: (id) => ({ ru: name(id), en: name(id) }), armorClass: (id) => Number(items[id]?.properties?.class) || 0 }
const MAP = { customs: 'Таможня', factory: 'Завод', woods: 'Лес', shoreline: 'Берег', interchange: 'Развязка', reserve: 'Резерв', lighthouse: 'Маяк', 'streets-of-tarkov': 'Улицы', 'the-lab': 'Лаборатория', 'the-labyrinth': 'Лабиринт', 'ground-zero': 'Эпицентр', terminal: 'Терминал', icebreaker: 'Ледокол' }

/** Who to compare: gallery key, the member's English name in bossRetinue.json, SPT's boss and role. */
const ROWS = [
  ['reshala', 'Решала', 'Guard', 'bossBully', 'followerBully'],
  ['shturman', 'Штурман', 'Guard', 'bossKojaniy', 'followerKojaniy'],
  ['sanitar', 'Санитар', 'Guard', 'bossSanitar', 'followerSanitar'],
  ['glukhar', 'Глухарь', 'Assault', 'bossGluhar', 'followerGluharAssault'],
  ['glukhar', 'Глухарь', 'Security', 'bossGluhar', 'followerGluharSecurity'],
  ['glukhar', 'Глухарь', 'Scout', 'bossGluhar', 'followerGluharScout'],
  ['kaban', 'Кабан', 'Guard', 'bossBoar', 'followerBoar'],
  ['kaban', 'Кабан', 'Basmach', 'bossBoar', 'followerBoarClose1'],
  ['kaban', 'Кабан', 'Gus', 'bossBoar', 'followerBoarClose2'],
  // SPT: the snipers are a spawn of their own (one sniper with one or two more), not Kaban's escort
  ['kaban', 'Кабан', 'Sniper', 'bossBoarSniper', 'bossBoarSniper'],
  ['kollontay', 'Коллонтай', 'Assault', 'bossKolontay', 'followerKolontayAssault'],
  ['kollontay', 'Коллонтай', 'Security', 'bossKolontay', 'followerKolontaySecurity'],
  ['wadge', 'Клин', 'Guard', 'bossWedgeLab', 'followerWedgeLab'],
  ['cultist-priest', 'Жрец культистов', 'Cultist warrior', 'sectantPriest', 'sectantWarrior'],
  ['zryachiy', 'Зрячий', 'Follower', 'bossZryachiy', 'followerZryachiy'],
  ['goon-1', 'Рыцарь (Отступники)', 'Big Pipe', 'bossKnight', 'followerBigPipe'],
  ['goon-2', 'Рыцарь (Отступники)', 'Birdeye', 'bossKnight', 'followerBirdEye'],
]
const GOON_PAGE = { followerBigPipe: 'goon-3', followerBirdEye: 'goon-1' }

/** Tier S and A of each category by price per slot (weapons by the whole price), as tierLists.ts ranks them. */
const VALUABLE = new Set(['57864a3d24597754843f8721', '5b47574386f77428ca22b2f1'])
function category(item) {
  const types = item.types ?? []
  const has = (type) => types.includes(type)
  if (has('preset') || (has('barter') && /dogtag/.test(item.normalizedName ?? ''))) return undefined
  const valuable = [...(item.categories ?? []), ...(item.handbookCategories ?? [])].some((id) => VALUABLE.has(id))
  if (has('keys')) return 'keys'
  if (has('injectors')) return 'injectors'
  if (has('meds')) return 'meds'
  if (has('provisions')) return 'food'
  if (valuable) return 'valuables'
  if (has('barter')) return 'barter'
  if (has('gun')) return 'weapons'
  if (has('ammo')) return 'ammo'
  if (has('armorPlate')) return 'plates'
  if (has('armor') && !has('rig') && !has('helmet')) return 'armor'
  for (const type of ['rig', 'helmet', 'headphones', 'backpack', 'container', 'mods']) if (has(type)) return type
  return undefined
}
function dearTiers(catalog) {
  const byCategory = new Map()
  for (const item of Object.values(catalog.items)) {
    const kind = category(item)
    const price = item.lastLowPrice || Math.max(0, ...(item.sellFor ?? []).filter((offer) => offer.vendor?.normalizedName !== 'flea-market').map((offer) => offer.priceRUB ?? 0))
    if (!kind || !(price > 0)) continue
    const score = kind === 'weapons' ? price : price / ((item.width || 1) * (item.height || 1))
    if (!byCategory.has(kind)) byCategory.set(kind, [])
    byCategory.get(kind).push([item.id, score])
  }
  const tiers = new Map()
  for (const rows of byCategory.values()) {
    const sorted = rows.map(([, score]) => score).sort((a, b) => b - a)
    for (const [id, score] of rows) {
      const share = sorted.findIndex((other) => other <= score) / sorted.length
      if (share < 0.3) tiers.set(id, share < 0.1 ? 'S' : 'A')
    }
  }
  return tiers
}
const TIERS = { pvp: dearTiers(pvpItems), pve: dearTiers(pveItems) }

const pct = (value) => `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)} %`
const list = (entries) => entries.length ? entries.join(', ') : '—'
const names = (entries = []) => list(entries.map((entry) => entry.name.ru))
const guns = (weapons = []) => list(weapons.map((weapon) => `${weapon.name.ru}${weapon.ammo.length ? ` (${weapon.ammo.map((round) => round.name.ru).join(', ')})` : ''}`))
const range = (value) => value ? (value[0] === value[1] ? `${value[0]}` : `${value[0]}–${value[1]}`) : '—'
const plates = (group) => group ? `спереди ${range(group.plates?.front)}, сзади ${range(group.plates?.back)}, бока ${range(group.plates?.side)}, шлем ${range(group.helmet)}${group.helmeted !== undefined ? ` (в шлеме ${Math.round(group.helmeted * 100)} %)` : ''}, в броне ${Math.round((group.armored ?? 0) * 100)} %` : '—'
const counts = (rows = []) => list(rows.map((row) => `${row.maps.map((id) => MAP[id] ?? id).join(', ')}: ${row.min === row.max ? row.min : `${row.min}–${row.max}`}`))
const dear = (loot, mode) => list(loot.filter((entry) => TIERS[mode].has(entry.id)).map((entry) => `${name(entry.id)} ${pct(entry.chance)}`))
const livePool = (mobs, mob) => (mobs.mobs[mob]?.items ?? []).filter((entry) => entry.attributes?.prevalence >= 1).map((entry) => ({ id: entry.id, chance: entry.attributes.prevalence }))

/** SPT: the tactical devices in the bot's weapon parts, and the highest chance of a tactical slot (report 201). */
const DEVICE_PARENTS = new Set(['55818b084bdc2d5b648b4571', '55818b164bdc2ddc698b456c', '55818b0e4bdc2dde698b456e'])
function sptLights(bot) {
  const devices = new Set()
  for (const slots of Object.values(bot.inventory.mods ?? {})) for (const list of Object.values(slots)) for (const id of list) if (DEVICE_PARENTS.has(spt.items[id]?._parent)) devices.add(id)
  const chances = Object.entries(bot.chances?.weaponMods ?? {}).filter(([slot]) => /tactical/.test(slot)).map(([, chance]) => chance)
  return devices.size ? `${[...devices].map(name).join(', ')}; тактический слот до ${Math.max(0, ...chances)} %` : '—'
}
const liveLights = (kit) => kit?.lights ? `на ${Math.round(kit.lights.share * 100)} % стволов (свет ${Math.round(kit.lights.white * 100)} %, ИК ${Math.round(kit.lights.ir * 100)} %): ${kit.lights.devices.map((device) => device.name.ru).join(', ')}` : '—'

const out = ['# Свита боссов: SPT против живой игры', '', `Собрано ${new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Bangkok' })} скриптом \`scripts/bosses/retinue-spt-report.mjs\`.`,
  'Слева — то, что показывает приложение (данные живой игры 1.3), справа — база офлайн-копии SPT 4.1.6 (клиент 0.16.9, только чтение).',
  'Дорогое — предметы с шансом от 1 %, только тиров S и A своей категории по цене за слот, отдельно по ценам PvP и PvE.', '']
for (const [key, boss, member, sptBoss, role] of ROWS) {
  const shown = retinue[key]?.members.find((entry) => entry.name.en === member)
  const kit = shown?.ref ? bossGear[shown.ref]?.groups[0] : shown
  const bot = await spt.bot(role)
  const sptKit = bot ? await sptGear(spt, role, live) : undefined
  const escorts = sptEscorts(spt, sptBoss, role)
  if (role === 'bossBoarSniper') for (const escort of escorts) { escort.min += 1; escort.max += 1 }
  const sptCounts = list(escorts.map((escort) => `${MAP[escort.map] ?? escort.map}: ${escort.min === escort.max ? escort.min : `${escort.min}–${escort.max}`} (босс ${escort.chance} %)`))
  const sptPool = bot ? await sptLoot(spt, role, 1) : []
  const livePvp = livePool(maps, role), livePve = livePool(pveMaps, role)
  const own = GOON_PAGE[role] ? ` — снаряжение на странице «${GOON_PAGE[role]}»` : key === 'zryachiy' ? ' — в живых данных их нет, в приложение взяты из SPT' : ''
  out.push(`## ${boss} — ${shown?.name.ru ?? member}${own}`, '', '| | Приложение (живая игра) | SPT 0.16.9 |', '|---|---|---|')
  const row = (label, left, right) => out.push(`| ${label} | ${left} | ${right} |`)
  row('Сколько', shown ? counts(shown.counts) : 'нет в приложении', escorts.length ? sptCounts : 'нет')
  if (!bot) { row('Бот', '', `в SPT нет \`${role}\` (появился после 0.16.9)`); out.push(''); continue }
  row('Оружие (патроны)', kit ? guns(kit.weapons) : '—', guns(sptKit.weapons))
  row('Шлем', kit ? names(kit.helmets) : '—', names(sptKit.helmets))
  row('Броня', kit ? names(kit.armor) : '—', names(sptKit.armor))
  row('Разгрузка', kit ? names(kit.rigs) : '—', names(sptKit.rigs))
  row('Классы', kit ? plates(kit) : '—', plates(sptKit))
  row('Фонари и ЛЦУ', liveLights(kit), sptLights(bot))
  row('Дорогое, PvP', dear(livePvp, 'pvp'), dear(sptPool, 'pvp'))
  row('Дорогое, PvE', dear(livePve, 'pve'), dear(sptPool, 'pve'))
  out.push('')
}
const text = `${out.join('\n')}\n`
if (outFile) await writeFile(outFile, text)
else process.stdout.write(text)
