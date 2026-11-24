#!/usr/bin/env node
/**
 * Writes src/import/gameWords.ts: the words of the game's own screens in its languages beyond Russian and English
 * (German, Japanese, Simplified Chinese, Polish, Spanish, Brazilian Portuguese, French, Korean, Turkish) that the screen
 * readers look for (the Tasks table's status cells and columns, the traders' screen, the exit list, the flea's chips, the
 * menus), taken from the game's official localisation — the locale files SPT installs with the game
 * (SPT_Data/database/locales/global/{en,ge,jp,ch,pl,es,es-mx,po,fr,kr,tu}.json; the same keys in every file) — and the map
 * and trader names and the quest parts' word from tarkov.dev's dictionaries (json.tarkov.dev/regular/{maps,traders,tasks}_
 * {lang}, the game's own texts too, newer than SPT's files: Terminal, Icebreaker).
 *
 * Every word is a list of the game's wordings: Spanish has two (the game's «Español», es, and «Español Latinoamérica»,
 * es-mx), and a player may run either; their differing words are both kept.
 *
 *   node scripts/ocr/game-words.mjs "E:\SPT\SPT_Runtime\SPT_Data\database\locales\global"
 *
 * Nothing is invented: a word a file lacks stays out, and the readers leave it out.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** The app's code of each language → SPT's locale files of it (several: all their wordings kept). */
const LANGUAGES = { de: ['ge'], ja: ['jp'], zh: ['ch'], pl: ['pl'], es: ['es', 'es-mx'], pt: ['po'], fr: ['fr'], ko: ['kr'], tr: ['tu'] }
const OUT = resolve('src/import/gameWords.ts')

/** Locale keys (the English text beside each, as SPT's en.json has it). An array of keys: a list of separate words. */
const KEYS = {
  status: {
    active: 'QuestStatusStarted', // active!
    ready: 'QuestStatusAvailableForFinish', // finished!
    done: 'QuestStatusSuccess', // completed
    failed: 'QuestStatusFail', // failed
    locked: 'QuestStatusLocked', // Locked
    available: 'QuestStatusAvailableForStart', // ready
  },
  anyLocation: 'any', // Any location
  columns: ['QuestTypeMerchant', 'Type', 'Task', 'Location', 'Status', 'Progress'],
  tasks: ['TASKS', 'quests'], // TASKS, Tasks
  operational: 'DailyQuests', // Operational tasks
  taskItems: ['Quest items in inventory (in-raid)', 'Quest items special stash (off-raid)', 'QUEST ITEMS'],
  paneHeadings: ['Achievements/Tooltip/Task rewards', 'QuestInitialsEquipment', 'Achievements/Tooltip/Conditions'], // Rewards, Initial equipment, Objectives
  menu: ['MainMenu', 'HIDEOUT', 'Character', 'MERCHANTS', 'RAG FAIR', 'PRESETS', 'HANDBOOK', 'MAIL', 'SURVEY', 'Back', 'APC/FastAccess',
    'OVERALL', 'GEAR', 'HEALTH_TAB', 'SKILLS', 'MAP', 'TASKS', 'Achievements', 'Prestige', 'Search'],
  notTasks: ['MAIL', 'RAG FAIR', 'BUY', 'SELL', 'DEAL!'], // MESSENGER, FLEA MARKET, BUY, SELL, DEAL!
  trader: {
    attitude: 'Current attitude:',
    you: '(you)',
    loyalty: 'Loyalty level (LL)',
    showLocked: 'QuestsShowLocked',
    nextLevel: 'Next LL requirements:',
  },
  modes: { pve: 'ESessionMode/Pve', pvp: 'ESessionMode/Regular' }, // PVE ZONE, PVP ZONE
  exits: {
    exfil: 'EXFIL', // EXFIL (ВЫХОД)
    transit: 'CUS_TRANSIT_10', // TRANSIT01: the word without its number
    find: 'FindEp', // Find an extraction point
    stay: 'StayInEpInside', // Stay in the extraction point
    back: 'StayInEpOutside', // Get back to the extraction point
  },
  flea: {
    condition: 'ragfair/Condition from:',
    noBarter: 'ragfair/RemoveBartering',
    total: 'ragfair/TOTAL:',
    limit: 'UI/FleaMarket/items_left_available',
  },
}

/** tarkov.dev map ids → the app's map ids (src/data/mapIds.ts). */
const MAPS = {
  '55f2d3fd4bdc2d5f408b4567': 'factory', '56f40101d2720b2a4d8b45d6': 'customs', '5704e3c2d2720bac5b8b4567': 'woods',
  '5704e4dad2720bb55b8b4567': 'lighthouse', '5704e554d2720bac5b8b456e': 'shoreline', '5704e5fad2720bc05b8b4567': 'reserve',
  '5714dbc024597771384a510d': 'interchange', '5714dc692459777137212e12': 'streets-of-tarkov', '5b0fc42d86f7744a585f9105': 'the-lab',
  '653e6760052c01c1c805532f': 'ground-zero', '65cc8f81a9aac3e77d0cfd3e': 'terminal', '6733700029c367a3d40b02af': 'the-labyrinth',
  '69af492a4819ea4ba10a69c5': 'icebreaker',
}
/** tarkov.dev trader ids → the app's trader keys (src/gunsmith/traderLevels.ts). */
const TRADERS = {
  '54cb50c76803fa8b248b4571': 'prapor', '54cb57776803fa99248b456e': 'therapist', '579dc571d53a0658a154fbec': 'fence',
  '58330581ace78e27b8b10cee': 'skier', '5935c25fb3acc3127c3d8cd9': 'peacekeeper', '5a7c2eca46aef81a7ca2145d': 'mechanic',
  '5ac3b934156ae10c4430e83c': 'ragman', '5c0647fdd443bc2504c2d371': 'jaeger', '638f541a29ffd1183d187f57': 'lightkeeper',
  '6617beeaa9cfa777ca915b7c': 'ref',
}

const clean = (value) => (typeof value === 'string' ? value.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '').replace(/\s+/g, ' ') : '')
const unique = (list) => [...new Set(list.filter(Boolean))]

/**
 * The words of the keys in every locale file of a language: a key alone → the list of its wordings; a list of keys → the
 * list of their wordings in key order (columns: one list per column); an object → the same for each of its fields.
 */
function pick(locales, spec, perKey = false) {
  if (typeof spec === 'string') return unique(locales.map((locale) => clean(locale[spec])))
  if (Array.isArray(spec)) return perKey ? spec.map((key) => pick(locales, key)) : unique(spec.flatMap((key) => pick(locales, key)))
  return Object.fromEntries(Object.entries(spec).map(([name, inner]) => [name, pick(locales, inner, name === 'columns')]))
}

async function dictionary(name, lang) {
  const response = await fetch(`https://json.tarkov.dev/regular/${name}_${lang}`, { headers: { 'accept-encoding': 'gzip' } })
  if (!response.ok) throw new Error(`${name}_${lang}: ${response.status}`)
  return (await response.json()).data
}

/**
 * The words before a quest part's number in this language («Teil»; Turkish has «Bölüm» and the English «Part»), from the
 * titles whose English says «- Part N»: each word a tenth of them or more carries. The English «Part» is left out (the
 * readers know it).
 */
function partWords(english, target) {
  const counts = new Map()
  let parts = 0
  for (const [key, name] of Object.entries(english)) {
    if (!/ name$/.test(key) || !/-\s*Part\s+\d+/.test(name ?? '') || typeof target[key] !== 'string') continue
    parts += 1
    const match = /(\S+)\s+\d+\s*(?:\[[^\]]*\]|（[^）]*）)?\s*$/u.exec(target[key])
    const word = match?.[1]
    if (word && /^\p{L}+$/u.test(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).filter(([word, count]) => count * 10 >= parts && word !== 'Part').map(([word]) => word)
}

const folder = process.argv[2]
if (!folder) {
  console.error('usage: node scripts/ocr/game-words.mjs <SPT locales/global folder>')
  process.exit(1)
}
const english = JSON.parse(await readFile(join(folder, 'en.json'), 'utf8'))
const tasksEnglish = await dictionary('tasks', 'en')
const words = {}
for (const [language, files] of Object.entries(LANGUAGES)) {
  const locales = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(folder, `${file}.json`), 'utf8'))))
  const entry = pick(locales, KEYS)
  // «TRANSIT01», «PRZEJŚ.01», «TRÁN. 01»: the word without its number.
  entry.exits.transit = unique(entry.exits.transit.map((word) => word.replace(/\s*\d+$/, '')))
  const [maps, traders, tasks] = await Promise.all(['maps', 'traders', 'tasks'].map((name) => dictionary(name, language)))
  entry.part = partWords(tasksEnglish, tasks)
  entry.maps = Object.fromEntries(Object.entries(MAPS).map(([id, app]) => [app, clean(maps[`${id} Name`])]).filter(([, name]) => name))
  entry.traders = Object.fromEntries(Object.entries(TRADERS).map(([id, app]) => [app, clean(traders[`${id} Nickname`])]).filter(([, name]) => name))
  words[language] = entry
}
// The English of the same keys, for the reader of this file.
const reference = pick([english], KEYS)

const header = `/**
 * GENERATED by scripts/ocr/game-words.mjs — do not edit by hand. The game's own words in its languages beyond Russian and
 * English that the screen readers look for: the game's official localisation (the locale files SPT installs, EFT 0.16.9:
 * SPT_Data/database/locales/global/{ge,jp,ch,pl,es,es-mx,po,fr,kr,tu}.json) and tarkov.dev's dictionaries (map and trader
 * names, the quest parts' word). Each word is the list of the game's wordings (Spanish: «Español» and «Español
 * Latinoamérica»), under the role the readers give it; the English of the same locale keys:
 * ${JSON.stringify(reference).replace(/\*\//g, '* /')}
 */
import type { ExtraGameLanguage } from './gameLanguage.js'

export interface GameWords {
  /** The Tasks table's status cells (QuestStatus…): active, ready to hand in, handed in, failed, locked, can be taken. */
  status: { active: string[]; ready: string[]; done: string[]; failed: string[]; locked: string[]; available: string[] }
  /** «Any location» of the location column. */
  anyLocation: string[]
  /** The Tasks table's column heads: trader, type, task, location, status, progress (each its wordings). */
  columns: string[][]
  /** «TASKS». */
  tasks: string[]
  /** «Operational tasks». */
  operational: string[]
  /** The right panel's headers: task items on the character, in the stash. */
  taskItems: string[]
  /** Headings of a quest's pane: rewards, initial equipment, objectives. */
  paneHeadings: string[]
  /** Captions of the menus around (the bottom bar, the character's tabs). */
  menu: string[]
  /** Screens that name quests and are not the Tasks list: messenger, flea market, buy, sell, deal. */
  notTasks: string[]
  /** The traders' screen: «Current attitude:», «(you)», the loyalty level, «Show locked», the next level's requirements. */
  trader: { attitude: string[]; you: string[]; loyalty: string[]; showLocked: string[]; nextLevel: string[] }
  /** The modes' names: PVE ZONE, PVP ZONE. */
  modes: { pve: string[]; pvp: string[] }
  /** The exit list: «EXFIL» before each exit, «TRANSIT» before each transit, its headers. */
  exits: { exfil: string[]; transit: string[]; find: string[]; stay: string[]; back: string[] }
  /** The flea: «Condition from:», «Exclude bartering offers», «Total», «limit». */
  flea: { condition: string[]; noBarter: string[]; total: string[]; limit: string[] }
  /** The words before a quest part's number («Teil»; the English «Part» left out); none when the titles carry none. */
  part: string[]
  /** Map names by the app's map id. */
  maps: Record<string, string>
  /** Trader names by the app's trader key. */
  traders: Record<string, string>
}

export const GAME_WORDS: Record<ExtraGameLanguage, GameWords> = ${JSON.stringify(words, null, 2)}
`
await writeFile(OUT, header, 'utf8')
console.log(`written ${OUT}`)
