// SPT 4.1.6 loose/static loot: forced spawns, ~100 % points, quest items vs tarkov.dev possibleLocations. Read-only on SPT.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
const SPT = 'E:/SPT/SPT_Runtime/SPT_Data/database'
const TD = process.argv[2], OUT = process.argv[3]
const j = (p) => JSON.parse(readFileSync(p, 'utf8'))
const items = j(`${SPT}/templates/items.json`)
const ru = j(`${SPT}/locales/global/ru.json`)
const name = (tpl) => ru[`${tpl} Name`] ?? tpl
const isQuest = (tpl) => Boolean(items[tpl]?._props?.QuestItem)
const LOC_TO_NORM = { bigmap: 'customs', factory4_day: 'factory', factory4_night: 'factory', interchange: 'interchange', laboratory: 'the-lab', labyrinth: 'the-labyrinth', lighthouse: 'lighthouse', rezervbase: 'reserve', sandbox: 'ground-zero', sandbox_high: 'ground-zero', shoreline: 'shoreline', tarkovstreets: 'streets-of-tarkov', woods: 'woods', terminal: 'terminal' }

const out = { forced: [], high: [], staticForced: [], questItems: [] }
const forcedQuest = new Map() // tpl -> [{map, pos}]
for (const loc of readdirSync(`${SPT}/locations`)) {
  const dir = `${SPT}/locations/${loc}`
  if (!existsSync(`${dir}/looseLoot.json`)) continue
  const map = LOC_TO_NORM[loc] ?? loc
  const L = j(`${dir}/looseLoot.json`)
  for (const sp of L.spawnpointsForced ?? []) {
    const root = sp.template.Items.find((i) => i._id === sp.template.Root) ?? sp.template.Items[0]
    const p = sp.template.Position
    const row = { loc, map, tpl: root._tpl, name: name(root._tpl), quest: isQuest(root._tpl), probability: sp.probability, pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }, id: sp.template.Id, alwaysSpawn: sp.template.IsAlwaysSpawn }
    out.forced.push(row)
    if (row.quest) { const list = forcedQuest.get(root._tpl) ?? []; list.push(row); forcedQuest.set(root._tpl, list) }
  }
  for (const sp of L.spawnpoints ?? []) {
    if (sp.probability < 0.99) continue
    const dist = sp.itemDistribution ?? []
    const total = dist.reduce((s, d) => s + d.relativeProbability, 0)
    const byTpl = {}
    for (const d of dist) {
      const it = sp.template.Items.find((i) => i.composedKey === d.composedKey?.key || i._id === d.composedKey?.key)
      const tpl = it?._tpl ?? d.composedKey?.key
      byTpl[tpl] = (byTpl[tpl] ?? 0) + d.relativeProbability / (total || 1)
    }
    const top = Object.entries(byTpl).sort((a, b) => b[1] - a[1])[0]
    const p = sp.template.Position
    out.high.push({ loc, map, probability: sp.probability, topItem: top && { tpl: top[0], name: name(top[0]), share: +top[1].toFixed(3), quest: isQuest(top[0]) }, pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }, id: sp.template.Id, alwaysSpawn: sp.template.IsAlwaysSpawn, kinds: Object.keys(byTpl).length })
  }
  if (existsSync(`${dir}/staticContainers.json`)) {
    const S = j(`${dir}/staticContainers.json`)
    for (const f of S.staticForced ?? []) out.staticForced.push({ loc, map, container: f.containerId, tpl: f.itemTpl, name: name(f.itemTpl), quest: isQuest(f.itemTpl) })
  }
}

// tarkov.dev quest item locations, per mode
const mapIdToNorm = new Map()
for (const m of Object.values(j(`${TD}/regular_maps.json`).data.maps)) mapIdToNorm.set(m.id, { 'night-factory': 'factory', 'ground-zero-21': 'ground-zero', 'ground-zero-tutorial': 'ground-zero' }[m.normalizedName] ?? m.normalizedName)
const tdLocs = {}
for (const mode of ['pvp', 'pve', 'seasonal']) {
  const d = j(`${TD}/app_${mode}.json`)
  const per = new Map()
  for (const t of [...Object.values(d.raw.tasks), ...Object.values(d.added)]) for (const o of t.objectives ?? []) {
    if (o.type !== 'findQuestItem') continue
    const tpl = o.questItem?.id ?? o.questItem
    const entry = per.get(tpl) ?? { tasks: new Set(), positions: [] }
    entry.tasks.add(d.dict?.[t.name] ?? t.name)
    for (const l of o.possibleLocations ?? []) for (const p of l.positions ?? []) entry.positions.push({ map: mapIdToNorm.get(l.map?.id ?? l.map), ...p })
    per.set(tpl, entry)
  }
  tdLocs[mode] = per
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
for (const [tpl, rows] of forcedQuest) {
  const r = { tpl, name: name(tpl), spt: rows.map((x) => ({ map: x.map, pos: x.pos })), modes: {} }
  for (const mode of ['pvp', 'pve', 'seasonal']) {
    const e = tdLocs[mode].get(tpl)
    if (!e) { r.modes[mode] = { inTasks: false }; continue }
    const matched = rows.map((x) => { const near = e.positions.filter((p) => p.map === x.map).map((p) => dist(p, x.pos)); return near.length ? +Math.min(...near).toFixed(1) : null })
    r.modes[mode] = { inTasks: true, tasks: [...e.tasks], tdPositions: e.positions.length, nearest: matched }
  }
  out.questItems.push(r)
}
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log('forced', out.forced.length, 'quest', out.forced.filter((x) => x.quest).length, 'non-quest', out.forced.filter((x) => !x.quest).length)
console.log('high (>=0.99)', out.high.length, 'staticForced', out.staticForced.length, 'non-quest staticForced', out.staticForced.filter((x) => !x.quest).length)
console.log('quest items forced', out.questItems.length)
for (const q of out.questItems) {
  const s = ['pvp', 'pve', 'seasonal'].map((m) => { const x = q.modes[m]; return !x.inTasks ? `${m}:нет в квестах` : `${m}:${x.tdPositions}т ближ ${x.nearest.join('/')}` }).join(' | ')
  console.log(' ', q.name, '|', q.spt.map((p) => p.map).join(','), '|', s)
}
