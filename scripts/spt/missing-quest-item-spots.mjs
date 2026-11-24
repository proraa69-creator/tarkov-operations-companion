// For every findQuestItem objective of the app's tasks: SPT forced spawn positions of its quest item that the objective lacks.
import { readFileSync, writeFileSync } from 'node:fs'
const TD = process.argv[2], OUT = process.argv[3]
const j = (p) => JSON.parse(readFileSync(p, 'utf8'))
const L = j(process.argv[4] ?? `${TD}/../loot_result.json`)
const mapIdToNorm = new Map(), normToIds = new Map()
for (const m of Object.values(j(`${TD}/regular_maps.json`).data.maps)) {
  const n = { 'night-factory': 'factory', 'ground-zero-21': 'ground-zero', 'ground-zero-tutorial': 'ground-zero' }[m.normalizedName] ?? m.normalizedName
  mapIdToNorm.set(m.id, n); normToIds.set(n, [...(normToIds.get(n) ?? []), { id: m.id, norm: m.normalizedName }])
}
const sptByTpl = new Map()
for (const f of L.forced) if (f.quest) {
  const list = sptByTpl.get(f.tpl) ?? []
  if (!list.some((p) => p.map === f.map && Math.hypot(p.pos.x - f.pos.x, p.pos.y - f.pos.y, p.pos.z - f.pos.z) < 0.3)) list.push(f)
  sptByTpl.set(f.tpl, list)
}
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const rows = []
for (const mode of ['pvp', 'pve', 'seasonal']) {
  const d = j(`${TD}/app_${mode}.json`)
  const tasks = [...Object.values(d.raw.tasks).map((t) => [t, false]), ...Object.values(d.added).map((t) => [t, true])]
  for (const [t, curated] of tasks) for (const o of t.objectives ?? []) {
    if (o.type !== 'findQuestItem') continue
    const tpl = o.questItem?.id ?? o.questItem
    const spt = sptByTpl.get(tpl) ?? []
    const objMaps = new Set([...(o.maps ?? []).map((m) => mapIdToNorm.get(m?.id ?? m)), ...(o.possibleLocations ?? []).map((l) => mapIdToNorm.get(l.map?.id ?? l.map))])
    const have = (o.possibleLocations ?? []).flatMap((l) => (l.positions ?? []).map((p) => ({ map: mapIdToNorm.get(l.map?.id ?? l.map), ...p })))
    const onMaps = spt.filter((s) => objMaps.size === 0 || objMaps.has(s.map))
    const extra = onMaps.filter((s) => !have.some((h) => h.map === s.map && d3(h, s.pos) < 1.0))
    rows.push({ mode, taskId: t.id, task: curated ? t.name : d.dict[t.name] ?? t.name, curated, objectiveId: o.id, tpl, item: spt[0]?.name ?? tpl, objMaps: [...objMaps], td: have.length, spt: onMaps.length, sptOtherMaps: spt.length - onMaps.length, extra: extra.map((e) => ({ map: e.map, ...e.pos, nearest: have.filter((h) => h.map === e.map).length ? +Math.min(...have.filter((h) => h.map === e.map).map((h) => d3(h, e.pos))).toFixed(1) : null })) })
  }
}
writeFileSync(OUT, JSON.stringify(rows, null, 1))
for (const r of rows.filter((r) => r.mode === 'pvp' && (r.extra.length || r.td === 0))) console.log(r.task, '|', r.item, '| td', r.td, 'spt', r.spt, '(+other maps', r.sptOtherMaps + ')', '| extra', r.extra.length, r.extra.map((e) => e.nearest).join('/'))
const modesDiffer = new Set()
for (const r of rows) { const p = rows.find((x) => x.mode === 'pvp' && x.objectiveId === r.objectiveId); if (p && (p.td !== r.td || p.extra.length !== r.extra.length)) modesDiffer.add(`${r.task} ${r.mode} td ${r.td} vs pvp ${p.td}`) }
console.log('modes differ:', [...modesDiffer])
