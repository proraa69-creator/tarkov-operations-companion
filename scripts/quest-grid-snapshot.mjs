#!/usr/bin/env node
// «Сетка квестов» (owner, 12.10.2026: «возьми с сайтов Tarkov Dev, Tarkov Help всю историю квестов, всю сетку квестов и
// сопоставляй с тем, что есть сейчас»). Writes two files from the live sites:
//
// - src/data/questGrid.snapshot.json — what the app needs offline: per mode (regular / pve / pvp-season) the unlock
//   conditions tarkov.dev keeps outside `taskRequirements` (`otherRequirements`: a trader line and its level, given in a
//   trader dialogue), the order of each trader's lines, and per task tarkov.help's view (loyalty level, character level,
//   Kappa, previous quests) plus the quests tarkov.help still lists that the game no longer has (history).
// - docs/quests/quest-grid-report.md — the comparison in Russian: tarkov.dev against tarkov.help and against what the app
//   used until now.
//
// Usage: node scripts/quest-grid-snapshot.mjs [--from <dir>]   (--from: a folder with the same files already downloaded)
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = join(ROOT, 'src/data/questGrid.snapshot.json')
const REPORT = join(ROOT, 'docs/quests/quest-grid-report.md')
const MODES = ['regular', 'pve', 'pvp-season']
const MODE_LABEL = { regular: 'PvP', pve: 'PvE', 'pvp-season': 'Сезон' }
const HELP_URL = (lang) => `https://tarkov.help/api/${lang}/quest-map?game_mode=regular`
const fromIndex = process.argv.indexOf('--from')
const fromDir = fromIndex > 0 ? process.argv[fromIndex + 1] : undefined

async function getJson(url, file) {
  if (fromDir) return JSON.parse(await readFile(join(fromDir, file), 'utf8'))
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

// The same folding as src/data/tarkovHelpGunsmith.ts helpNameKey: case, «ё», Latin look-alikes, punctuation and spaces.
const LOOKALIKES = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н' }
const ruKey = (name) => String(name).toLowerCase().replace(/ё/g, 'е').replace(/[aceopxykmtbh]/g, (char) => LOOKALIKES[char] ?? char).replace(/[^\p{L}\p{N}]+/gu, '')
const enKey = (name) => String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const LOYALTY_NODE = /^Уровень лояльности - (\d) \((.+)\)$/
const KEY_NODE = /^Ключевые квесты \((.+)\)$/

// ---------------------------------------------------------------- tarkov.dev
const dev = {}
for (const mode of MODES) {
  const [tasks, ru, en, traders, tradersRu] = await Promise.all([
    getJson(`https://json.tarkov.dev/${mode}/tasks`, `tasks-${mode}.json`),
    getJson(`https://json.tarkov.dev/${mode}/tasks_ru`, `${mode}-tasks_ru.json`),
    getJson(`https://json.tarkov.dev/${mode}/tasks_en`, `${mode}-tasks_en.json`),
    getJson(`https://json.tarkov.dev/${mode}/traders`, `${mode}-traders.json`),
    getJson(`https://json.tarkov.dev/${mode}/traders_ru`, `${mode}-traders_ru.json`),
  ])
  const traderRows = Object.values(traders.data ?? {})
  const traderName = Object.fromEntries(traderRows.map((trader) => [trader.id, tradersRu.data?.[trader.name] ?? trader.name]))
  const rows = Object.values(tasks.data.tasks).map((task) => ({
    id: task.id,
    ru: ru.data?.[task.name] ?? task.name,
    en: en.data?.[task.name] ?? task.name,
    traderId: task.trader,
    trader: traderName[task.trader] ?? task.trader,
    level: Math.max(1, Number(task.minPlayerLevel) || 1),
    kappa: task.kappaRequired === true,
    faction: task.factionName,
    requirements: (task.taskRequirements ?? []).map((requirement) => ({ task: requirement.task, status: requirement.status ?? ['complete'] })),
    loyalty: (task.traderRequirements ?? []).filter((requirement) => (requirement.requirementType ?? 'level') === 'level')
      .map((requirement) => ({ trader: requirement.trader, level: Number(requirement.value) + (requirement.compareMethod === '>' ? 1 : 0) })),
    other: task.otherRequirements ?? [],
  }))
  dev[mode] = { rows, byId: new Map(rows.map((row) => [row.id, row])), traderName, updated: tasks.updated }
}

/** tarkov.dev `otherRequirements`: a line (global variable) at a level, or a trader dialogue. */
function unlockOf(row) {
  const lines = []
  let dialogue = false
  for (const requirement of row.other) {
    if (requirement.type === 'dialogue') dialogue = true
    if (requirement.type !== 'globalVariable' || !requirement.variableId) continue
    const value = Number(requirement.value)
    if (!Number.isFinite(value)) continue
    if (requirement.compareMethod === '>=' || requirement.compareMethod === '=' || requirement.compareMethod === '==') lines.push([requirement.variableId, value])
    else if (requirement.compareMethod === '>') lines.push([requirement.variableId, value + 1])
  }
  return { lines, dialogue }
}

// ---------------------------------------------------------------- tarkov.help
const helpRu = await getJson(HELP_URL('ru'), 'quest-map-ru-regular.json')
const helpEn = await getJson(HELP_URL('en'), 'quest-map-en-regular.json')
function flatten(nodes, out = new Map()) {
  for (const node of nodes ?? []) {
    if (!out.has(node.id)) out.set(node.id, node)
    flatten(node.mapping_quests, out)
  }
  return out
}
const helpNodes = flatten(helpRu.data)
const helpEnglish = flatten(helpEn.data)
const regular = dev.regular
const byRuKey = new Map()
const byEnKey = new Map()
for (const row of regular.rows) {
  const ruBucket = `${row.traderId}|${ruKey(row.ru)}`
  byRuKey.set(ruBucket, [...(byRuKey.get(ruBucket) ?? []), row.id])
  byRuKey.set(`*|${ruKey(row.ru)}`, [...(byRuKey.get(`*|${ruKey(row.ru)}`) ?? []), row.id])
  byEnKey.set(`*|${enKey(row.en)}`, [...(byEnKey.get(`*|${enKey(row.en)}`) ?? []), row.id])
}
// tarkov.help tags some quests with the faction or a choice («Должник [BEAR]», «… [выбор]»); the game's name has no tag.
const TAG = /\s*\[(?:bear|usec|выбор|choice)\]\s*$/i
const taskIdsOfNode = new Map()
for (const node of helpNodes.values()) {
  const english = helpEnglish.get(node.id)?.name
  const names = [...new Set([node.name, node.name.replace(TAG, '')])]
  const englishNames = english ? [...new Set([english, english.replace(TAG, '')])] : []
  const ids = names.map((entry) => byRuKey.get(`${node.trader_id}|${ruKey(entry)}`) ?? byRuKey.get(`*|${ruKey(entry)}`)).find(Boolean)
    ?? englishNames.map((entry) => byEnKey.get(`*|${enKey(entry)}`)).find(Boolean) ?? []
  taskIdsOfNode.set(node.id, ids)
}
const traderNameBySlug = { storyteller: 'Сюжет' }
for (const node of helpNodes.values()) {
  const loyalty = LOYALTY_NODE.exec(node.name)
  if (loyalty) traderNameBySlug[node.trader_slug] = loyalty[2]
  else if (regular.traderName[node.trader_id]) traderNameBySlug[node.trader_slug] ??= regular.traderName[node.trader_id]
}

/** tarkov.help's view of a task: loyalty level, character level, Kappa, previous quests (task ids or names). */
const help = {}
const history = []
for (const node of helpNodes.values()) {
  const ids = taskIdsOfNode.get(node.id)
  if (LOYALTY_NODE.test(node.name) || KEY_NODE.test(node.name)) continue
  let loyalty = Math.max(0, ...(node.trader_req ?? []).map((requirement) => Number(requirement.loyalty) || 0))
  const after = []
  const afterNames = []
  for (const parent of node.parent_quests ?? []) {
    const loyaltyParent = LOYALTY_NODE.exec(parent.name)
    if (loyaltyParent) { loyalty = Math.max(loyalty, Number(loyaltyParent[1])); continue }
    if (KEY_NODE.test(parent.name)) continue
    const parentIds = taskIdsOfNode.get(parent.id) ?? []
    if (parentIds.length) after.push(...parentIds)
    else afterNames.push(parent.name)
  }
  const entry = {
    // tarkov.help's own name, only where it is not the game's (the snapshot stays small)
    ...(ids.length && ids.every((id) => ruKey(regular.byId.get(id)?.ru ?? '') === ruKey(node.name)) ? {} : { name: node.name }),
    ...(loyalty ? { ll: loyalty } : {}),
    ...(node.level_req ? { level: node.level_req } : {}),
    ...(node.kappa_req ? { kappa: true } : {}),
    ...(node.is_unlocked_over_time ? { timed: true } : {}),
    ...(after.length ? { after: [...new Set(after)].sort() } : {}),
    ...(afterNames.length ? { afterNames: [...new Set(afterNames)] } : {}),
  }
  if (ids.length) for (const id of ids) help[id] = entry
  else history.push({ trader: traderNameBySlug[node.trader_slug] ?? node.trader_slug, name: node.name, slug: node.seo_link, ...entry, ...(helpEnglish.get(node.id)?.name ? { en: helpEnglish.get(node.id).name } : {}) })
}

// ---------------------------------------------------------------- lines and their order per trader
const modes = {}
for (const mode of MODES) {
  const { rows } = dev[mode]
  const tasks = {}
  const lineQuests = new Map()
  for (const row of rows) {
    const unlock = unlockOf(row)
    if (!unlock.lines.length && !unlock.dialogue) continue
    tasks[row.id] = { ...(unlock.lines.length ? { lines: unlock.lines } : {}), ...(unlock.dialogue ? { dialogue: true } : {}) }
    for (const [line, level] of unlock.lines) lineQuests.set(line, [...(lineQuests.get(line) ?? []), { row, level }])
  }
  const lines = {}
  const perTrader = new Map()
  for (const [line, members] of lineQuests) {
    const traders = [...new Set(members.map((member) => member.row.traderId))]
    // tarkov.help files a line's quests under one loyalty level: the most common one among them.
    const votes = new Map()
    for (const { row } of members) if (help[row.id]?.ll) votes.set(help[row.id].ll, (votes.get(help[row.id].ll) ?? 0) + 1)
    const loyalty = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0]
    lines[line] = { trader: traders[0], ...(traders.length > 1 ? { traders } : {}), ...(loyalty ? { ll: loyalty } : {}), levels: [...new Set(members.map((member) => member.level))].sort((a, b) => a - b) }
    perTrader.set(traders[0], [...(perTrader.get(traders[0]) ?? []), line])
  }
  // Order of a trader's lines: tarkov.help's loyalty level, then the variable's id (BSG made them in that order).
  for (const ids of perTrader.values()) {
    ids.sort((a, b) => (lines[a].ll ?? 9) - (lines[b].ll ?? 9) || a.localeCompare(b))
    ids.forEach((id, index) => { lines[id].order = index + 1 })
  }
  modes[mode] = { tasks: sortKeys(tasks), lines: sortKeys(lines) }
}

function sortKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
}

const snapshot = {
  format: 1,
  generatedAt: new Date().toISOString(),
  sources: {
    tarkovDev: Object.fromEntries(MODES.map((mode) => [mode, { url: `https://json.tarkov.dev/${mode}/tasks`, tasks: dev[mode].rows.length }])),
    tarkovHelp: { url: HELP_URL('ru'), quests: [...helpNodes.values()].filter((node) => !LOYALTY_NODE.test(node.name) && !KEY_NODE.test(node.name)).length, matched: Object.keys(help).length, history: history.length },
  },
  // A mode whose lines are the same as PvP's only names it.
  modes: Object.fromEntries(MODES.map((mode) => [mode, mode !== 'regular' && JSON.stringify(modes[mode]) === JSON.stringify(modes.regular) ? 'regular' : modes[mode]])),
  help: sortKeys(help),
  history: history.sort((a, b) => a.trader.localeCompare(b.trader, 'ru') || a.name.localeCompare(b.name, 'ru')),
}
await mkdir(dirname(SNAPSHOT), { recursive: true })
await writeFile(SNAPSHOT, `${JSON.stringify(snapshot)}\n`)

// ---------------------------------------------------------------- report
const md = []
const line = (text = '') => md.push(text)
const name = (mode, id) => dev[mode].byId.get(id)?.ru ?? id
const traderOf = (mode, id) => dev[mode].byId.get(id)?.trader ?? '?'
const table = (head, rows) => {
  if (!rows.length) { line('_Нет._'); line(); return }
  line(`| ${head.join(' | ')} |`)
  line(`|${head.map(() => '---').join('|')}|`)
  for (const row of rows) line(`| ${row.map((cell) => String(cell ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)
  line()
}
const byTraderThenName = (a, b) => a[0].localeCompare(b[0], 'ru') || a[1].localeCompare(b[1], 'ru')
const today = snapshot.generatedAt.slice(0, 10)

line('# Сетка квестов: tarkov.dev, tarkov.help и приложение')
line()
line(`Снимок от ${today}. Собран скриптом \`node scripts/quest-grid-snapshot.mjs\`; данные для приложения — \`src/data/questGrid.snapshot.json\`.`)
line()
// filled in below, once the comparison is done
const SUMMARY_AT = md.length
line('## Источники')
line()
table(['Источник', 'Что взято', 'Квестов'], [
  ...MODES.map((mode) => [`tarkov.dev ${MODE_LABEL[mode]}`, `json.tarkov.dev/${mode}/tasks: условия открытия, уровни, лояльность, цепочки`, dev[mode].rows.length]),
  ['tarkov.help (только PvP)', 'api/ru|en/quest-map: дерево квестов по торговцам, уровень лояльности, уровень персонажа, Каппа, предыдущие квесты', `${snapshot.sources.tarkovHelp.quests} (сопоставлено с tarkov.dev: ${new Set(Object.values(help)).size})`],
])

// How quests open now
const unlockCounts = (mode) => {
  const { rows } = dev[mode]
  const unlock = rows.map((row) => ({ row, ...unlockOf(row) }))
  return {
    lines: unlock.filter((entry) => entry.lines.length).length,
    dialogue: unlock.filter((entry) => entry.dialogue).length,
    chains: rows.filter((row) => row.requirements.length).length,
    loyalty: rows.filter((row) => row.loyalty.length).length,
    nothing: unlock.filter((entry) => !entry.lines.length && !entry.dialogue && !entry.row.requirements.length && !entry.row.loyalty.length && entry.row.level <= 1).length,
  }
}
line('## Как квесты открываются в текущей версии игры')
line()
line('В данных tarkov.dev у квестов теперь есть условия вне цепочек (`otherRequirements`): **ветка торговца и её уровень** (глобальная переменная игры, «уровень ≥ N») и **диалог с торговцем** (стартовые квесты). До этой версии приложение их не читало и показывало такие квесты доступными с 1-го уровня.')
line()
table(['Режим', 'Ветка + уровень', 'Диалог', 'Цепочка (предыдущий квест)', 'Лояльность', 'Без условий вовсе'], MODES.map((mode) => {
  const counts = unlockCounts(mode)
  return [MODE_LABEL[mode], counts.lines, counts.dialogue, counts.chains, counts.loyalty, counts.nothing]
}))
line('### Ветки торговцев по уровням (PvP)')
line()
line('Уровень лояльности ветки — по tarkov.help (там квесты ветки висят под одним уровнем лояльности).')
line()
{
  const { lines } = modes.regular
  const rowsByLine = new Map()
  for (const row of regular.rows) for (const [variable, level] of unlockOf(row).lines) rowsByLine.set(variable, [...(rowsByLine.get(variable) ?? []), { row, level }])
  const ordered = Object.entries(lines).sort(([, a], [, b]) => (regular.traderName[a.trader] ?? '').localeCompare(regular.traderName[b.trader] ?? '', 'ru') || a.order - b.order)
  table(['Торговец', 'Ветка', 'Уровни и квесты'], ordered.map(([variable, info]) => [
    regular.traderName[info.trader] ?? info.trader,
    `${info.order}${info.ll ? ` (LL${info.ll})` : ''}`,
    info.levels.map((level) => `**${level}:** ${(rowsByLine.get(variable) ?? []).filter((entry) => entry.level === level).map((entry) => entry.row.ru).sort((a, b) => a.localeCompare(b, 'ru')).join(', ')}`).join('<br>'),
  ]))
  const dialogue = regular.rows.filter((row) => unlockOf(row).dialogue).map((row) => [row.trader, row.ru]).sort(byTraderThenName)
  line('### Стартовые квесты (выдаются в диалоге)')
  line()
  table(['Торговец', 'Квест'], dialogue)
}

// Differences
line('## Расхождения tarkov.dev ↔ tarkov.help (PvP)')
line()
const devOnly = regular.rows.filter((row) => !help[row.id]).map((row) => [row.trader, row.ru, row.level]).sort(byTraderThenName)
line(`### Есть в игре (tarkov.dev), нет на tarkov.help — ${devOnly.length}`)
line()
table(['Торговец', 'Квест', 'Ур.'], devOnly)
line(`### Есть на tarkov.help, нет в текущей игре (история, события, сюжет) — ${history.length}`)
line()
table(['Торговец', 'Квест', 'После'], history.map((entry) => [entry.trader, entry.name, (entry.afterNames ?? []).concat((entry.after ?? []).map((id) => name('regular', id))).join(', ')]))
const levelDiff = []
const kappaDiff = []
const loyaltyDiff = []
const edgeDevOnly = []
const edgeHelpOnly = []
for (const row of regular.rows) {
  const view = help[row.id]
  if (!view) continue
  if (view.level && view.level !== row.level) levelDiff.push([row.trader, row.ru, row.level, view.level])
  if (Boolean(view.kappa) !== row.kappa) kappaDiff.push([row.trader, row.ru, row.kappa ? 'да' : 'нет', view.kappa ? 'да' : 'нет'])
  const devLoyalty = Math.max(0, ...row.loyalty.filter((entry) => entry.trader === row.traderId).map((entry) => entry.level))
  const unlock = unlockOf(row)
  const lineLoyalty = unlock.lines.map(([variable]) => modes.regular.lines[variable]?.ll).find(Boolean)
  if (view.ll && devLoyalty && view.ll !== devLoyalty) loyaltyDiff.push([row.trader, row.ru, `LL${devLoyalty}`, `LL${view.ll}`])
  else if (view.ll && !devLoyalty && !lineLoyalty && view.ll > 1) loyaltyDiff.push([row.trader, row.ru, 'нет', `LL${view.ll}`])
  const devAfter = new Set(row.requirements.map((requirement) => requirement.task))
  const helpAfter = new Set(view.after ?? [])
  for (const requirement of row.requirements) if (!helpAfter.has(requirement.task)) edgeDevOnly.push([row.trader, row.ru, `${name('regular', requirement.task)}${requirement.status.join() === 'complete' ? '' : ` (${requirement.status.join(' / ')})`}`])
  for (const id of helpAfter) if (!devAfter.has(id)) edgeHelpOnly.push([row.trader, row.ru, name('regular', id)])
  for (const parent of view.afterNames ?? []) edgeHelpOnly.push([row.trader, row.ru, `${parent} (нет в игре)`])
}
line(`### Уровень персонажа отличается — ${levelDiff.length}`)
line()
line('В текущей игре многие квесты открываются ветками и лояльностью, а не уровнем персонажа: у tarkov.dev там стоит 1.')
line()
table(['Торговец', 'Квест', 'tarkov.dev', 'tarkov.help'], levelDiff.sort(byTraderThenName))
line(`### Лояльность отличается или есть только на tarkov.help — ${loyaltyDiff.length}`)
line()
table(['Торговец', 'Квест', 'tarkov.dev', 'tarkov.help'], loyaltyDiff.sort(byTraderThenName))
line(`### Предыдущий квест есть только в tarkov.dev — ${edgeDevOnly.length}`)
line()
table(['Торговец', 'Квест', 'Нужен до него'], edgeDevOnly.sort(byTraderThenName))
line(`### Предыдущий квест есть только на tarkov.help — ${edgeHelpOnly.length}`)
line()
table(['Торговец', 'Квест', 'Нужен до него'], edgeHelpOnly.sort(byTraderThenName))
line(`### Каппа отличается — ${kappaDiff.length}`)
line()
line(`tarkov.dev сейчас отмечает для Каппы ${regular.rows.filter((row) => row.kappa).length} квестов, tarkov.help — ${new Set(Object.entries(help).filter(([, view]) => view.kappa).map(([id]) => id)).size} (старый список).`)
line()
table(['Торговец', 'Квест', 'tarkov.dev', 'tarkov.help'], kappaDiff.sort(byTraderThenName))

line('## PvP ↔ PvE ↔ Сезон (tarkov.dev)')
line()
for (const mode of ['pve', 'pvp-season']) {
  const other = dev[mode]
  const onlyRegular = regular.rows.filter((row) => !other.byId.has(row.id)).map((row) => [row.trader, row.ru]).sort(byTraderThenName)
  const onlyOther = other.rows.filter((row) => !regular.byId.has(row.id)).map((row) => [row.trader, row.ru]).sort(byTraderThenName)
  const changed = []
  for (const row of other.rows) {
    const base = regular.byId.get(row.id)
    if (!base) continue
    const fields = []
    if (base.level !== row.level) fields.push(`уровень ${base.level} → ${row.level}`)
    if (JSON.stringify(base.requirements) !== JSON.stringify(row.requirements)) fields.push(`предыдущие: ${base.requirements.map((requirement) => `${name('regular', requirement.task)} (${requirement.status.join('/')})`).join(', ') || '—'} → ${row.requirements.map((requirement) => `${name(mode, requirement.task)} (${requirement.status.join('/')})`).join(', ') || '—'}`)
    if (JSON.stringify(base.loyalty) !== JSON.stringify(row.loyalty)) fields.push(`лояльность ${base.loyalty.map((entry) => `LL${entry.level}`).join(',') || '—'} → ${row.loyalty.map((entry) => `LL${entry.level}`).join(',') || '—'}`)
    if (JSON.stringify(unlockOf(base)) !== JSON.stringify(unlockOf(row))) fields.push('условия открытия (ветка/диалог)')
    if (fields.length) changed.push([row.trader, row.ru, fields.join('; ')])
  }
  line(`### PvP → ${MODE_LABEL[mode]}`)
  line()
  line(`Только в PvP: ${onlyRegular.length}; только в ${MODE_LABEL[mode]}: ${onlyOther.length}; отличаются условия: ${changed.length}.`)
  line()
  if (onlyRegular.length) { line('Только в PvP:'); line(); table(['Торговец', 'Квест'], onlyRegular) }
  if (onlyOther.length) { line(`Только в ${MODE_LABEL[mode]}:`); line(); table(['Торговец', 'Квест'], onlyOther) }
  if (changed.length) { line('Отличаются:'); line(); table(['Торговец', 'Квест', 'Что'], changed.sort(byTraderThenName)) }
}
// «Главное» at the top: the numbers the owner asked about first.
{
  const counts = unlockCounts('regular')
  const quests = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'квест' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'квеста' : 'квестов'}`
  // «у N квеста / квестов»
  const ofQuests = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'квеста' : 'квестов'}`
  const summary = [
    '## Главное',
    '',
    `- **Как игра открывает квесты сейчас.** ${quests(counts.lines)} открываются **ветками торговцев по уровням** (у каждого из семи основных торговцев 3–4 ветки, по одной на уровень лояльности; внутри ветки — уровни 1…5), ${counts.dialogue} — **в диалоге** с торговцем (первые задания), ${counts.chains} — по цепочке (предыдущий квест), ${counts.loyalty} — по лояльности. До этой версии приложение ветки и диалоги не читало и считало такие квесты доступными с 1-го уровня.`,
    `- **tarkov.help** знает ${quests(snapshot.sources.tarkovHelp.quests)} (только PvP): ${new Set(Object.values(help)).size} сопоставлены с игрой, ${history.length} — история (удалённые цепочки, события KORD BREACH, сюжетные главы). ${quests(devOnly.length)} игры на tarkov.help нет.`,
    `- **Каппа:** tarkov.dev отмечает ${quests(regular.rows.filter((row) => row.kappa).length)}, tarkov.help — ${new Set(Object.entries(help).filter(([, view]) => view.kappa).map(([id]) => id)).size} (это старый список).`,
    `- **Уровень персонажа** расходится у ${ofQuests(levelDiff.length)}: в новой системе их открывают ветки и лояльность, а не уровень.`,
    `- **PvP / PvE / Сезон:** сетка одинаковая, кроме квестов Арены ([PVP ZONE] / [PVE ZONE]) и нескольких условий (раздел в конце).`,
    '',
    '## Как приложение теперь считает статусы',
    '',
    '1. **Логи игры** — правда: взято, сдано, провалено.',
    '2. **Цепочка:** всё, что требует квест из логов, выполнено.',
    '3. **Ветка:** квест из логов на N-м уровне ветки показывает, что ветка дошла до N. Её квесты уровней ниже — «вероятно выполнено», того же уровня — открыты, выше — «откроется на N-м уровне».',
    '4. **Лояльность:** квест из логов на уровне лояльности N (его ветка или требование) показывает, что этапы торговца ниже N пройдены — их квесты «вероятно выполнено».',
    '5. **Старт:** первые (диалоговые) квесты торговца пройдены, если в логах есть его более поздний квест.',
    '6. Пункты 3–5 работают, только если история игрока началась раньше самых старых логов (квест из логов требует то, чего в логах нет). Новый аккаунт или вайп целиком в логах — тогда ничего не додумывается. «Оружейник» — только по логам. Квесты другой фракции, выше уровня персонажа и «ветвления» (открываются взятием или провалом другого квеста) не додумываются никогда.',
    '',
  ]
  md.splice(SUMMARY_AT, 0, ...summary)
}
await mkdir(dirname(REPORT), { recursive: true })
await writeFile(REPORT, `${md.join('\n').replace(/\n{3,}/g, '\n\n')}\n`)

const size = (await readFile(SNAPSHOT)).length
console.log(`snapshot ${SNAPSHOT} ${(size / 1024).toFixed(1)} KB; help matched ${Object.keys(help).length}, history ${history.length}`)
for (const mode of MODES) console.log(`${mode}: ${Object.keys(modes[mode].tasks).length} tasks with line/dialogue, ${Object.keys(modes[mode].lines).length} lines`)
console.log(`report ${REPORT}`)
