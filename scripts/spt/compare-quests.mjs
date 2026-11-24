// Compare the app's quests (tarkov.dev + curated, per mode) with the SPT 4.1.6 database. Read-only on SPT.
import { readFileSync, writeFileSync } from 'node:fs'

const SPT = 'E:/SPT/SPT_Runtime/SPT_Data'
const TD = process.argv[2]
const OUT = process.argv[3]
const j = (p) => JSON.parse(readFileSync(p, 'utf8'))

const quests = j(`${SPT}/database/templates/quests.json`)
const archived = j(`${SPT}/database/templates/archivedQuests.json`)
const ru = j(`${SPT}/database/locales/global/ru.json`)
const en = j(`${SPT}/database/locales/global/en.json`)
const items = j(`${SPT}/database/templates/items.json`)
const qcfg = j(`${SPT}/configs/quest.json`)
const tdItemsRu = j(`${TD}/regular_items_ru.json`).data
const tdMaps = j(`${TD}/regular_maps.json`).data.maps
const tdMapsArr = Array.isArray(tdMaps) ? tdMaps : Object.values(tdMaps)

const MAP_FOLD = { 'night-factory': 'factory', 'ground-zero-21': 'ground-zero', 'ground-zero-tutorial': 'ground-zero' }
const mapIdToNorm = new Map()
for (const m of tdMapsArr) mapIdToNorm.set(m.id, MAP_FOLD[m.normalizedName] ?? m.normalizedName)
const locIdMap = Object.fromEntries(Object.entries(qcfg.locationIdMap).map(([k, v]) => [k.toLowerCase(), v]))
// SPT names tarkov.dev has not in locationIdMap
const EXTRA_LOC = { sandbox: '653e6760052c01c1c805532f', sandbox_high: '65b8d6f5cdde2479cb2a3125', labyrinth: '6733700029c367a3d40b02af', terminal: '68236e8153654e8c1200798a' }
function locToNorm(name) {
  const id = locIdMap[String(name).toLowerCase()] ?? EXTRA_LOC[String(name).toLowerCase()] ?? name
  return mapIdToNorm.get(id) ?? `?${name}`
}

const itemName = (tpl) => ru[`${tpl} Name`] ?? tdItemsRu[`${tpl} Name`] ?? tpl
const isQuestItem = (tpl) => Boolean(items[tpl]?._props?.QuestItem)
const traderName = (id) => ru[`${id} Nickname`] ?? id
const STATUS = { 2: 'active', 3: 'active', 4: 'complete', 5: 'failed', 6: 'failed', 7: 'failed' }

// ---------- SPT normalization ----------
const usecOnly = new Set(qcfg.usecOnlyQuests), bearOnly = new Set(qcfg.bearOnlyQuests)

function sptRewards(list, mode) {
  const out = { xp: 0, standing: {}, items: {}, offers: [], skills: [], crafts: [], achievements: [], traderUnlock: [], customization: [], hidden: [], other: [] }
  for (const r of list ?? []) {
    const gm = r.gameMode ?? []
    if (gm.length && !gm.includes(mode)) continue
    switch (r.type) {
      case 'Experience': out.xp += r.value; break
      case 'TraderStanding': out.standing[r.target] = round((out.standing[r.target] ?? 0) + r.value); break
      case 'Item': {
        const root = r.items.find((i) => i._id === r.target) ?? r.items[0]
        // a stack reward lists several root items (ammo packs): count all roots of the same tpl
        const roots = r.items.filter((i) => !i.parentId)
        const count = roots.length > 1 ? roots.reduce((s, i) => s + (i.upd?.StackObjectsCount ?? 1), 0) : r.value
        out.items[root._tpl] = (out.items[root._tpl] ?? 0) + count
        if (r.isHidden || r.unknown) out.hidden.push(root._tpl)
        break
      }
      case 'AssortmentUnlock': { const root = r.items.find((i) => i._id === r.target) ?? r.items[0]; out.offers.push(`${r.traderId}:${root._tpl}:${r.loyaltyLevel}`); break }
      case 'Skill': out.skills.push(`${r.target}:${r.value / 100}`); break
      case 'ProductionScheme': { const root = r.items.find((i) => i._id === r.target) ?? r.items[0]; out.crafts.push(root._tpl); break }
      case 'Achievement': out.achievements.push(r.target); break
      case 'TraderUnlock': out.traderUnlock.push(r.target); break
      case 'CustomizationDirect': out.customization.push(r.target); break
      default: out.other.push(r.type)
    }
  }
  return out
}
const round = (n) => Math.round(n * 1000) / 1000

function sptObjective(c, quest) {
  const o = { id: c.id, kind: c.conditionType, count: c.value ?? null, items: [], fir: false, maps: [], dogtag: 0, parentId: c.parentId || '' }
  const qloc = quest.location && quest.location !== 'any' ? [mapIdToNorm.get(quest.location) ?? `?${quest.location}`] : []
  switch (c.conditionType) {
    case 'HandoverItem': o.type = c.target.some(isQuestItem) ? 'giveQuestItem' : 'giveItem'; o.items = [...c.target]; o.fir = c.onlyFoundInRaid; o.dogtag = c.dogtagLevel ?? 0; break
    case 'FindItem': o.type = c.target.some(isQuestItem) ? 'findQuestItem' : 'findItem'; o.items = [...c.target]; o.fir = c.onlyFoundInRaid; o.dogtag = c.dogtagLevel ?? 0; break
    case 'LeaveItemAtLocation': o.type = c.target.some(isQuestItem) ? 'plantQuestItem' : 'plantItem'; o.items = [...c.target]; o.fir = c.onlyFoundInRaid; o.zone = c.zoneId; o.maps = qloc; break
    case 'PlaceBeacon': o.type = 'mark'; o.items = [...c.target]; o.zone = c.zoneId; o.maps = qloc; break
    case 'WeaponAssembly': o.type = 'buildWeapon'; o.items = [...c.target]; break
    case 'Skill': o.type = 'skill'; o.skill = `${c.target}:${c.value}`; break
    case 'TraderLoyalty': o.type = 'traderLevel'; o.trader = `${c.target}:${c.value}`; break
    case 'TraderStanding': o.type = 'traderStanding'; o.trader = `${c.target}:${c.value}`; break
    case 'Quest': o.type = 'taskStatus'; o.task = c.target; break
    case 'SellItemToTrader': o.type = 'sellItem'; o.items = [...c.target]; break
    case 'HideoutArea': o.type = 'hideout'; break
    case 'VisitPlace': o.type = 'visit'; o.zone = c.target; break
    case 'GlobalVariableValue': o.type = 'globalVariable'; break
    case 'CounterCreator': {
      const subs = c.counter.conditions
      const kinds = subs.map((s) => s.conditionType)
      const locs = subs.filter((s) => s.conditionType === 'Location').flatMap((s) => s.target)
      o.maps = locs.length ? [...new Set(locs.map(locToNorm))] : qloc
      o.counter = kinds
      if (kinds.includes('Kills')) {
        o.type = 'shoot'
        const k = subs.find((s) => s.conditionType === 'Kills')
        o.target = [k.target, ...(k.savageRole ?? [])].join('/')
        o.bodyParts = [...(k.bodyPart ?? [])].sort()
        o.distance = k.distance?.value ?? 0
        o.weapons = (k.weapon ?? []).length
      } else if (kinds.includes('VisitPlace')) { o.type = 'visit'; o.zone = subs.find((s) => s.conditionType === 'VisitPlace').target }
      else if (kinds.includes('LaunchFlare')) o.type = 'useItem'
      else if (kinds.includes('ExitStatus') || kinds.includes('ExitName')) {
        o.type = 'extract'
        const en = subs.find((s) => s.conditionType === 'ExitName'); if (en) o.exitName = en.exitName
        const es = subs.find((s) => s.conditionType === 'ExitStatus'); if (es) o.exitStatus = [...es.status].sort()
      } else if (kinds.includes('HealthEffect') || kinds.includes('HealthBuff')) o.type = 'experience'
      else if (kinds.includes('InZone')) { o.type = 'visit'; o.zone = subs.find((s) => s.conditionType === 'InZone').zoneIds?.join(',') }
      else if (kinds.includes('Shots')) o.type = 'shoot'
      else o.type = `counter:${kinds.join('+')}`
      break
    }
    default: o.type = c.conditionType
  }
  return o
}

function sptQuest(q, mode) {
  const start = q.conditions.AvailableForStart ?? []
  const level = start.filter((c) => c.conditionType === 'Level').map((c) => c.value)[0] ?? 0
  const prereq = start.filter((c) => c.conditionType === 'Quest').map((c) => ({ task: c.target, status: [...new Set(c.status.map((s) => STATUS[s] ?? `s${s}`))].sort(), delay: c.availableAfter ?? 0, dispersion: c.dispersion ?? 0 }))
  const traderReq = start.filter((c) => c.conditionType === 'TraderLoyalty' || c.conditionType === 'TraderStanding').map((c) => `${c.conditionType === 'TraderLoyalty' ? 'level' : 'reputation'}:${c.target}:${c.compareMethod}${c.value}`)
  const objectives = (q.conditions.AvailableForFinish ?? []).map((c) => sptObjective(c, q))
  const fail = (q.conditions.Fail ?? []).map((c) => `${c.conditionType}:${c.target ?? c.counter?.conditions?.map((s) => s.conditionType).join('+') ?? ''}`)
  return {
    id: q._id, trader: q.traderId, nameRu: ru[`${q._id} name`] ?? q.QuestName, nameEn: en[`${q._id} name`] ?? q.QuestName,
    level, prereq, traderReq, objectives, fail, restartable: Boolean(q.restartable),
    faction: usecOnly.has(q._id) ? 'USEC' : bearOnly.has(q._id) ? 'BEAR' : 'Any',
    gameModes: q.gameModes ?? [], location: q.location,
    finish: sptRewards(q.rewards.Success, mode), start: sptRewards(q.rewards.Started, mode), failOut: sptRewards(q.rewards.Fail, mode),
  }
}

// ---------- app (tarkov.dev + curated) normalization ----------
function tdRewards(r) {
  const out = { xp: 0, standing: {}, items: {}, offers: [], skills: [], crafts: [], achievements: [], traderUnlock: [], customization: [], hidden: [], other: [] }
  if (!r) return out
  for (const s of r.traderStanding ?? []) out.standing[s.trader?.id ?? s.trader] = round((out.standing[s.trader?.id ?? s.trader] ?? 0) + s.standing)
  for (const i of r.items ?? []) { const id = i.item?.id ?? i.item; out.items[id] = (out.items[id] ?? 0) + i.count }
  for (const o of r.offerUnlock ?? []) out.offers.push(`${o.trader?.id ?? o.trader}:${o.item?.id ?? o.item}:${o.level}`)
  for (const s of r.skillLevelReward ?? []) out.skills.push(`${s.skill?.id ?? s.skill ?? s.name}:${s.level}`)
  for (const c of r.craftUnlock ?? []) out.crafts.push(c.item?.id ?? c.item)
  for (const a of r.achievement ?? []) out.achievements.push(a?.id ?? a)
  for (const t of r.traderUnlock ?? []) out.traderUnlock.push(t?.id ?? t)
  for (const c of r.customization ?? []) out.customization.push(c?.id ?? c)
  return out
}
function tdObjective(o) {
  const ids = o.items ? o.items.map((i) => i?.id ?? i) : o.questItem ? [o.questItem?.id ?? o.questItem] : o.item ? [o.item?.id ?? o.item] : o.markerItem ? [o.markerItem?.id ?? o.markerItem] : o.useAny ? o.useAny.map((i) => i?.id ?? i) : []
  return {
    id: o.id, type: o.type, count: o.count ?? null, items: ids, fir: Boolean(o.foundInRaid), dogtag: o.dogTagLevel ?? 0, optional: Boolean(o.optional),
    maps: [...new Set((o.maps ?? []).map((m) => mapIdToNorm.get(m?.id ?? m) ?? m?.normalizedName ?? m))],
    zones: (o.zones ?? []).map((z) => z.id), hasLocations: Boolean(o.possibleLocations?.length),
    locationMaps: (o.possibleLocations ?? []).map((l) => mapIdToNorm.get(l.map?.id ?? l.map)),
    bodyParts: (o.bodyParts ?? []).map((b) => String(b).split('/').pop()).sort(), distance: o.distance?.value ?? 0, weapons: (o.usingWeapon ?? []).length,
    exitName: o.exitName ?? undefined, exitStatus: o.exitStatus ? [...o.exitStatus].sort() : undefined, targetNames: o.targetNames,
    skill: o.skill ? `${o.skill}:${o.level}` : o.skillLevel ? `${o.skillLevel.skill ?? o.skillLevel.name}:${o.skillLevel.level}` : undefined,
    trader: o.type === 'traderLevel' ? `${o.trader?.id ?? o.trader}:${o.level}` : o.type === 'traderStanding' ? `${o.trader?.id ?? o.trader}:${o.value}` : undefined,
    task: o.task?.id ?? o.task,
  }
}
function tdQuest(t, dict, curated) {
  const name = (key) => (curated ? key : dict[key] ?? key)
  return {
    id: t.id, trader: t.trader?.id ?? t.trader, nameRu: name(t.name), curated,
    level: t.minPlayerLevel ?? 0,
    prereq: (t.taskRequirements ?? []).map((r) => ({ task: r.task?.id ?? r.task, status: [...r.status].sort() })),
    traderReq: (t.traderRequirements ?? []).map((r) => `${r.requirementType}:${r.trader?.id ?? r.trader}:${r.compareMethod}${r.value}`),
    objectives: (t.objectives ?? []).map(tdObjective),
    fail: (t.failConditions ?? []).map((c) => `${c.type}:${c.task?.id ?? c.task ?? ''}`),
    restartable: Boolean(t.restartable), faction: t.factionName ?? 'Any',
    delay: [t.availableDelaySecondsMin ?? 0, t.availableDelaySecondsMax ?? 0],
    xp: t.experience ?? 0,
    finish: tdRewards(t.finishRewards), start: tdRewards(t.startRewards), failOut: tdRewards(t.failureOutcome),
    kappa: t.kappaRequired, lightkeeper: t.lightkeeperRequired, other: (t.otherRequirements ?? []).map((r) => r.type),
  }
}

const MODES = [['pvp', 'regular'], ['pve', 'pve'], ['seasonal', 'regular']]
const app = {}
for (const [mode] of MODES) {
  const dump = j(`${TD}/app_${mode}.json`)
  const map = new Map()
  for (const t of Object.values(dump.raw.tasks)) map.set(t.id, tdQuest(t, dump.dict, false))
  for (const t of Object.values(dump.added)) map.set(t.id, tdQuest(t, dump.dict, true))
  app[mode] = map
}

// ---------- compare ----------
const sameSet = (a, b) => { const x = [...a].sort().join('|'), y = [...b].sort().join('|'); return x === y }
const fmtItems = (rec) => Object.entries(rec).map(([id, n]) => `${itemName(id)} ×${n}`).join(', ') || '—'
const fmtStanding = (rec) => Object.entries(rec).map(([id, v]) => `${traderName(id)} ${v > 0 ? '+' : ''}${v}`).join(', ') || '—'

function compareRewards(where, a, s, diffs) {
  // a = app, s = SPT
  if (where === 'finish' && a.xpField !== undefined) {}
  if (!sameSet(Object.entries(a.standing).map((e) => e.join('=')), Object.entries(s.standing).map((e) => e.join('=')))) diffs.push({ field: `${where}.standing`, app: fmtStanding(a.standing), spt: fmtStanding(s.standing) })
  const ai = Object.entries(a.items).map((e) => e.join('=')), si = Object.entries(s.items).map((e) => e.join('='))
  if (!sameSet(ai, si)) diffs.push({ field: `${where}.items`, app: fmtItems(a.items), spt: fmtItems(s.items), appRaw: a.items, sptRaw: s.items })
  for (const key of ['offers', 'skills', 'crafts', 'achievements', 'traderUnlock', 'customization']) {
    if (!sameSet(a[key], s[key])) diffs.push({ field: `${where}.${key}`, app: a[key], spt: s[key] })
  }
}

function compareQuest(a, s) {
  const diffs = []
  if (a.trader !== s.trader) diffs.push({ field: 'trader', app: traderName(a.trader), spt: traderName(s.trader) })
  if ((a.level || 0) !== (s.level || 0)) diffs.push({ field: 'level', app: a.level, spt: s.level })
  const ap = a.prereq.map((p) => `${p.task}:${p.status.join('+')}`), sp = s.prereq.map((p) => `${p.task}:${p.status.join('+')}`)
  if (!sameSet(ap, sp)) diffs.push({ field: 'prereq', app: a.prereq, spt: s.prereq })
  const sDelay = s.prereq.reduce((m, p) => Math.max(m, p.delay), 0)
  if ((a.delay[0] || 0) !== sDelay && !(a.curated)) diffs.push({ field: 'delay', app: a.delay, spt: s.prereq.map((p) => [p.delay, p.dispersion]) })
  if (!sameSet(a.traderReq, s.traderReq)) diffs.push({ field: 'traderReq', app: a.traderReq, spt: s.traderReq })
  if (a.faction !== s.faction) diffs.push({ field: 'faction', app: a.faction, spt: s.faction })
  if (a.restartable !== s.restartable) diffs.push({ field: 'restartable', app: a.restartable, spt: s.restartable })
  if (a.xp !== s.finish.xp) diffs.push({ field: 'xp', app: a.xp, spt: s.finish.xp })
  compareRewards('finish', a.finish, s.finish, diffs)
  compareRewards('start', a.start, s.start, diffs)
  if (!sameSet(Object.entries(a.failOut.standing).map((e) => e.join('=')), Object.entries(s.failOut.standing).map((e) => e.join('=')))) diffs.push({ field: 'failOut.standing', app: fmtStanding(a.failOut.standing), spt: fmtStanding(s.failOut.standing) })
  // fail conditions: compare the quests they name
  const af = a.fail.filter((f) => f.startsWith('taskStatus')).map((f) => f.split(':')[1]), sf = s.fail.filter((f) => f.startsWith('Quest')).map((f) => f.split(':')[1])
  if (!sameSet(af, sf)) diffs.push({ field: 'fail.quests', app: af, spt: sf })
  const aOtherFail = a.fail.filter((f) => !f.startsWith('taskStatus')).length, sOtherFail = s.fail.filter((f) => !f.startsWith('Quest')).length
  if (aOtherFail !== sOtherFail) diffs.push({ field: 'fail.other', app: a.fail, spt: s.fail })
  // objectives by id; SPT's visibility-only sub-conditions (parentId) are part of their parent in tarkov.dev
  const aObj = new Map(a.objectives.map((o) => [o.id, o]))
  const sObj = new Map(s.objectives.map((o) => [o.id, o]))
  for (const [id, so] of sObj) {
    const ao = aObj.get(id)
    if (!ao) { diffs.push({ field: 'objective.onlySpt', id, spt: so, text: ru[id] }); continue }
    const d = []
    if (!typeCompatible(ao.type, so.type)) d.push(['type', ao.type, so.type])
    if (ao.count !== null && so.count !== null && ['giveItem', 'giveQuestItem', 'findItem', 'findQuestItem', 'plantItem', 'plantQuestItem', 'shoot', 'extract', 'sellItem', 'mark', 'visit', 'buildWeapon', 'useItem'].includes(ao.type) && Number(ao.count) !== Number(so.count)) d.push(['count', ao.count, so.count])
    if (ao.items.length && so.items.length && !sameSet(ao.items, so.items)) d.push(['items', ao.items, so.items])
    if (['giveItem', 'findItem', 'plantItem'].includes(ao.type) && ao.fir !== so.fir) d.push(['fir', ao.fir, so.fir])
    if ((ao.dogtag || 0) !== (so.dogtag || 0)) d.push(['dogtag', ao.dogtag, so.dogtag])
    if (ao.maps.length && so.maps.length && !sameSet(ao.maps, so.maps)) d.push(['maps', ao.maps, so.maps])
    if (ao.type === 'shoot' && so.type === 'shoot') {
      if (so.bodyParts && !sameSet(ao.bodyParts, so.bodyParts)) d.push(['bodyParts', ao.bodyParts, so.bodyParts])
      if (so.distance !== undefined && ao.distance !== so.distance) d.push(['distance', ao.distance, so.distance])
      if (so.weapons !== undefined && ao.weapons !== so.weapons) d.push(['weapons', ao.weapons, so.weapons])
    }
    if (ao.type === 'skill' && so.skill && ao.skill !== so.skill) d.push(['skill', ao.skill, so.skill])
    if (['traderLevel', 'traderStanding'].includes(ao.type) && so.trader && ao.trader !== so.trader) d.push(['trader', ao.trader, so.trader])
    if (ao.type === 'extract' && so.exitName && ao.exitName && ao.exitName !== so.exitName) d.push(['exitName', ao.exitName, so.exitName])
    if (['plantItem', 'plantQuestItem', 'mark'].includes(ao.type) && so.zone && ao.zones.length && !ao.zones.includes(so.zone)) d.push(['zone', ao.zones, so.zone])
    if (d.length) diffs.push({ field: 'objective', id, text: ru[id], changes: d })
  }
  for (const [id, ao] of aObj) {
    if (!sObj.has(id)) diffs.push({ field: 'objective.onlyApp', id, app: ao })
  }
  return diffs
}
function typeCompatible(a, s) {
  if (a === s) return true
  const pairs = [['giveItem', 'giveQuestItem'], ['findItem', 'findQuestItem'], ['plantItem', 'plantQuestItem'], ['visit', 'experience'], ['useItem', 'visit']]
  return pairs.some(([x, y]) => (a === x && s === y) || (a === y && s === x))
}

const result = { generated: new Date().toISOString(), modes: {}, sptOnly: [], appOnly: {}, archived: Object.keys(archived) }
const sptIds = new Set(Object.keys(quests))
for (const [mode, sptMode] of MODES) {
  const per = []
  for (const [id, q] of Object.entries(quests)) {
    const a = app[mode].get(id)
    if (!a) continue
    const s = sptQuest(q, sptMode)
    const diffs = compareQuest(a, s)
    per.push({ id, nameRu: a.nameRu, sptNameRu: s.nameRu, trader: traderName(s.trader), curated: a.curated, diffs })
  }
  result.modes[mode] = per
  result.appOnly[mode] = [...app[mode].values()].filter((a) => !sptIds.has(a.id)).map((a) => ({ id: a.id, nameRu: a.nameRu, trader: traderName(a.trader), curated: a.curated }))
}
for (const [id, q] of Object.entries(quests)) {
  const modes = MODES.filter(([m]) => app[m].has(id)).map(([m]) => m)
  if (modes.length === 3) continue
  const s = sptQuest(q, 'regular')
  result.sptOnly.push({ id, nameRu: s.nameRu, nameEn: s.nameEn, trader: traderName(s.trader), level: s.level, inModes: modes, gameModes: s.gameModes, prereq: s.prereq.map((p) => `${ru[`${p.task} name`] ?? p.task}`), xp: s.finish.xp, objectives: s.objectives.length })
}
writeFileSync(OUT, JSON.stringify(result, null, 1))
const count = (mode) => result.modes[mode].filter((q) => q.diffs.length).length
console.log('compared', Object.fromEntries(MODES.map(([m]) => [m, result.modes[m].length])), 'with diffs', Object.fromEntries(MODES.map(([m]) => [m, count(m)])))
console.log('sptOnly (not in all 3 modes)', result.sptOnly.length, 'appOnly', Object.fromEntries(MODES.map(([m]) => [m, result.appOnly[m].length])))
const fields = {}
for (const q of result.modes.pvp) for (const d of q.diffs) { const k = d.field === 'objective' ? `objective.${d.changes.map((c) => c[0]).join('+')}` : d.field; fields[k] = (fields[k] ?? 0) + 1 }
console.log(Object.entries(fields).sort((a, b) => b[1] - a[1]))
