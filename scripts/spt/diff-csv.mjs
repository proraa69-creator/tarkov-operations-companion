// The full list of differences (app vs SPT) as a CSV for Excel: one row per quest, field and value, with the modes it is in.
import { readFileSync, writeFileSync } from 'node:fs'
const S = process.argv[2], OUT = process.argv[3]
const j = (p) => JSON.parse(readFileSync(p, 'utf8'))
const r = j(`${S}/cmp_result.json`)
const ru = j('E:/SPT/SPT_Runtime/SPT_Data/database/locales/global/ru.json')
const tdItems = j(`${S}/td/regular_items_ru.json`).data
const tdTasks = j(`${S}/td/regular_tasks_ru.json`).data
const item = (t) => ru[`${t} Name`] ?? tdItems[`${t} Name`] ?? t
const trader = (t) => ru[`${t} Nickname`] ?? t
const quest = (t) => tdTasks[`${t} name`] ?? ru[`${t} name`] ?? t
const MODE = { pvp: 'PvP', pve: 'PvE', seasonal: 'Сезон' }
const FIELD = {
  trader: 'Торговец', level: 'Уровень', prereq: 'Предыдущие квесты', delay: 'Задержка после предыдущего, с', traderReq: 'Лояльность / репутация для взятия',
  faction: 'Фракция', restartable: 'Можно перезапустить', xp: 'Опыт', 'finish.standing': 'Репутация (награда)', 'finish.items': 'Предметы (награда)',
  'finish.offers': 'Открывает у торговца', 'finish.skills': 'Навыки (награда)', 'finish.crafts': 'Открывает крафт', 'finish.achievements': 'Достижение (награда)',
  'finish.traderUnlock': 'Открывает торговца', 'finish.customization': 'Оформление (награда)', 'start.items': 'Выдаётся при взятии',
  'start.offers': 'Открывает у торговца при взятии', 'start.crafts': 'Крафт при взятии', 'start.skills': 'Навыки при взятии', 'start.standing': 'Репутация при взятии',
  'failOut.standing': 'Репутация при провале', 'fail.quests': 'Проваливается, если выполнен', 'fail.other': 'Условия провала',
  objective: 'Цель изменена', 'objective.onlySpt': 'Цель только в SPT', 'objective.onlyApp': 'Цель только у нас',
}
const VERDICT = {
  'finish.achievements': 'Проверить: tarkov.dev не публикует часть достижений за квесты (вики для «Коллекционера» согласна с SPT)',
  'failOut.standing': 'Проверить в игре: tarkov.dev не публикует штрафы за провал',
  delay: 'Проверить в игре: tarkov.dev почти не публикует задержки',
  'fail.other': 'Проверить в игре',
}
const verdictOf = (field) => VERDICT[field] ?? 'Raid OS (живая игра 1.3): в SPT данные игры 0.16.9 (до 1.0)'
const offer = (s) => { const [t, it, ll] = s.split(':'); return `${item(it)} — ${trader(t)}, ур. ${ll}` }
const skill = (s) => { const [k, l] = s.split(':'); return `${k} ${l}` }
const list = (field, v) => {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (!v.length) return '—'
    if (field.endsWith('offers')) return v.map(offer).join('; ')
    if (field.endsWith('skills')) return v.map(skill).join('; ')
    if (field.endsWith('crafts')) return v.map(item).join('; ')
    if (field.endsWith('achievements')) return v.map((a) => ru[`${a} name`] ?? a).join('; ')
    if (field.endsWith('customization')) return v.map((c) => ru[`${c} Name`] ?? c).join('; ')
    if (field === 'prereq') return v.map((p) => `${quest(p.task)} (${p.status.join('/')})`).join('; ')
    if (field === 'traderReq') return v.map((x) => { const [k, t, c] = x.split(':'); return `${k === 'level' ? 'лояльность' : 'репутация'} ${trader(t)} ${c}` }).join('; ')
    if (field === 'fail.quests') return v.map(quest).join('; ')
    if (field === 'delay') return JSON.stringify(v)
    return v.join('; ')
  }
  return JSON.stringify(v)
}
const objText = (o) => `${o.type}${o.count ? ` ×${o.count}` : ''}${o.items?.length ? `: ${few(o.items)}` : ''}${o.maps?.length ? ` [${o.maps.join(', ')}]` : ''}`
const change = ([k, a, s]) => `${k}: ${Array.isArray(a) ? (k === 'items' ? a.map(item).join(', ') : a.join(', ')) : a} → ${Array.isArray(s) ? (k === 'items' ? s.map(item).join(', ') : s.join(', ')) : s}`

const few = (ids) => ids.slice(0, 5).map(item).join(', ') + (ids.length > 5 ? ` и ещё ${ids.length - 5}` : '')
// one side of an objective change; item lists as what this side has and the other has not
const side = (c, at) => {
  const [k, a, s] = c
  if (k === 'items') {
    const mine = at === 1 ? a : s, other = at === 1 ? s : a
    const only = mine.filter((id) => !other.includes(id))
    return `предметы: ${mine.length}${only.length ? `, только здесь: ${few(only)}` : ''}`
  }
  const v = at === 1 ? a : s
  return `${k}: ${Array.isArray(v) ? v.join(', ') : v}`
}
const rows = new Map()
for (const [mode, per] of Object.entries(r.modes)) for (const q of per) for (const d of q.diffs) {
  let app, spt, detail = ''
  if (d.field === 'objective') { app = d.changes.map((c) => side(c, 1)).join('; '); spt = d.changes.map((c) => side(c, 2)).join('; '); detail = d.text ?? d.id }
  else if (d.field === 'objective.onlySpt') { app = '—'; spt = objText(d.spt); detail = d.text ?? d.id }
  else if (d.field === 'objective.onlyApp') { app = objText(d.app); spt = '—'; detail = d.id.length === 24 ? d.id : '' }
  else { app = list(d.field, d.app); spt = list(d.field, d.spt) }
  const key = [q.id, d.field, d.id ?? '', app, spt].join('\u0001')
  const row = rows.get(key) ?? { trader: q.trader, name: q.nameRu, id: q.id, field: FIELD[d.field] ?? d.field, detail, app, spt, verdict: verdictOf(d.field), modes: [], curated: q.curated }
  row.modes.push(MODE[mode])
  rows.set(key, row)
}
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const header = ['Торговец', 'Квест', 'id квеста', 'Режимы', 'Что сравнивается', 'Цель', 'Raid OS (tarkov.dev и наши данные)', 'SPT 4.1.6 (игра 0.16.9)', 'Чьи данные верны']
const sorted = [...rows.values()].sort((a, b) => a.trader.localeCompare(b.trader, 'ru') || a.name.localeCompare(b.name, 'ru') || a.field.localeCompare(b.field, 'ru'))
const lines = [header.map(esc).join(';'), ...sorted.map((x) => [x.trader, x.name + (x.curated ? ' (наша серия)' : ''), x.id, x.modes.join(', '), x.field, x.detail, x.app, x.spt, x.verdict].map(esc).join(';'))]
writeFileSync(OUT, '\uFEFF' + lines.join('\r\n'), 'utf8')
console.log('rows', sorted.length)
