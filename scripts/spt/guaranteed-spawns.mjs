// 100 % spawns in SPT 4.1.6: forced loose items, always-spawn groups whose probabilities add up to whole raids, forced static
// container items; each checked against tarkov.dev's live loose-loot points / containers (PvP, PvE, Season).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
const DB = 'E:/SPT/SPT_Runtime/SPT_Data/database'
const TD = process.argv[2], OUT = process.argv[3]
const j = (p) => JSON.parse(readFileSync(p, 'utf8'))
const ru = j(`${DB}/locales/global/ru.json`), items = j(`${DB}/templates/items.json`)
const name = (t) => ru[`${t} Name`] ?? t
const LOC = { bigmap: 'customs', factory4_day: 'factory', factory4_night: 'night-factory', interchange: 'interchange', laboratory: 'the-lab', labyrinth: 'the-labyrinth', lighthouse: 'lighthouse', rezervbase: 'reserve', sandbox: 'ground-zero', sandbox_high: 'ground-zero-21', shoreline: 'shoreline', tarkovstreets: 'streets-of-tarkov', woods: 'woods' }
const EVENT = /christmas|halloween|event_|_event|Flash_for_event/i
const tdMaps = {}
for (const mode of ['regular', 'pve', 'pvp-season']) {
  const m = j(`${TD}/${mode}_maps.json`).data.maps
  tdMaps[mode] = Object.fromEntries((Array.isArray(m) ? m : Object.values(m)).map((x) => [x.normalizedName, x]))
}
const near = (mode, map, tpl, p) => {
  const loose = tdMaps[mode][map]?.lootLoose ?? []
  const withItem = loose.filter((l) => (l.items ?? []).map((i) => i?.id ?? i).includes(tpl))
  const d = withItem.map((l) => Math.hypot(l.position.x - p.x, l.position.y - p.y, l.position.z - p.z))
  return d.length ? +Math.min(...d).toFixed(2) : null
}
const r2 = (n) => +n.toFixed(2)
const out = []
for (const loc of readdirSync(`${DB}/locations`)) {
  const dir = `${DB}/locations/${loc}`
  if (!existsSync(`${dir}/looseLoot.json`)) continue
  const map = LOC[loc] ?? loc
  const L = j(`${dir}/looseLoot.json`)
  for (const sp of L.spawnpointsForced ?? []) {
    const root = sp.template.Items.find((i) => i._id === sp.template.Root) ?? sp.template.Items[0]
    if (items[root._tpl]?._props?.QuestItem || EVENT.test(sp.template.Id)) continue
    const p = sp.template.Position
    out.push({ source: 'spawnpointsForced', loc, map, tpl: root._tpl, name: name(root._tpl), kind: 'here', perRaid: 1, positions: [{ x: r2(p.x), y: r2(p.y), z: r2(p.z), probability: 1 }] })
  }
  const groups = {}
  for (const s of L.spawnpoints.filter((s) => s.template.IsAlwaysSpawn)) {
    if (EVENT.test(s.template.Id)) continue
    const tpls = new Set([(s.template.Items.find((i) => i._id === s.template.Root) ?? s.template.Items[0])._tpl])
    const key = [...tpls].join('+')
    ;(groups[key] ??= []).push(s)
  }
  for (const [key, arr] of Object.entries(groups)) {
    const sum = arr.reduce((a, s) => a + s.probability, 0)
    if (key.includes('+') || sum < 0.97) continue
    const tpl = key
    if (items[tpl]?._props?.QuestItem) continue
    out.push({ source: 'alwaysSpawn group', loc, map, tpl, name: name(tpl), kind: arr.length === 1 ? 'here' : 'one-of', perRaid: Math.round(sum * 100) / 100, positions: arr.map((s) => ({ x: r2(s.template.Position.x), y: r2(s.template.Position.y), z: r2(s.template.Position.z), probability: +s.probability.toFixed(3) })) })
  }
  if (existsSync(`${dir}/staticContainers.json`)) {
    const S = j(`${dir}/staticContainers.json`)
    for (const f of S.staticForced ?? []) {
      if (items[f.itemTpl]?._props?.QuestItem) continue
      const c = (S.staticContainers ?? []).find((x) => x.template?.Id === f.containerId)
      const p = c?.template?.Position
      if (out.some((o) => o.source === 'staticForced' && o.container === f.containerId && o.tpl === f.itemTpl)) continue
      out.push({ source: 'staticForced', loc, map, tpl: f.itemTpl, name: name(f.itemTpl), kind: 'here', perRaid: 1, container: f.containerId, containerTpl: c?.template?.Items?.[0]?._tpl, containerName: c ? name(c.template.Items[0]._tpl) : undefined, positions: p ? [{ x: r2(p.x), y: r2(p.y), z: r2(p.z), probability: 1 }] : [] })
    }
  }
}
for (const o of out) {
  o.td = {}
  for (const mode of ['regular', 'pve', 'pvp-season']) {
    if (o.source === 'staticForced') {
      const cs = tdMaps[mode][o.map]?.lootContainers ?? []
      const d = o.positions.map((p) => { const ds = cs.map((c) => Math.hypot(c.position.x - p.x, c.position.y - p.y, c.position.z - p.z)); return ds.length ? +Math.min(...ds).toFixed(2) : null })
      o.td[mode] = { nearestContainer: d }
    } else o.td[mode] = { nearestLoose: o.positions.map((p) => near(mode, o.map, o.tpl, p)) }
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 1))
for (const o of out) console.log(o.map, '|', o.name, '|', o.source, o.kind, 'за рейд', o.perRaid, '| точек', o.positions.length, '| tarkov.dev PvP:', JSON.stringify(o.td.regular), '| PvE:', JSON.stringify(o.td.pve))
