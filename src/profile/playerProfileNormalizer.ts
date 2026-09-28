import type { PlayerProfileSnapshot } from '../domain/types.js'

type JsonRecord = Record<string, unknown>

export interface PlayerLevelRow {
  level: number
  exp: number
}

export function normalizePlayerProfile(value: unknown, levels: PlayerLevelRow[], fetchedAt = new Date().toISOString()): PlayerProfileSnapshot {
  const root = record(value)
  const info = record(root.info ?? root.Info)
  const accountId = finiteNumber(root.aid)
  const nickname = string(info.nickname ?? info.Nickname).trim()
  const experience = Math.max(0, finiteNumber(info.experience ?? info.Experience))
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !nickname) throw new Error('Некорректный профиль Tarkov.dev')
  const updated = finiteNumber(root.updated)
  const equipmentRoot = record(root.equipment)
  const equipmentId = string(equipmentRoot.Id ?? equipmentRoot.id)
  const equipment = array(equipmentRoot.Items ?? equipmentRoot.items).flatMap((entry) => {
    const item = record(entry)
    const itemId = string(item._tpl ?? item.tpl)
    const slotId = string(item.slotId ?? item.SlotId)
    const parentId = string(item.parentId ?? item.ParentId)
    return itemId && slotId && (!equipmentId || parentId === equipmentId) ? [{ itemId, slotId }] : []
  })
  const memberCategory = finiteNumber(info.memberCategory ?? info.MemberCategory)
  const pmcStats = record(record(root.pmcStats).eft)
  return {
    accountId,
    nickname,
    experience,
    level: levelFromExperience(experience, levels),
    faction: normalizeFaction(info.side ?? info.Side),
    prestige: Math.max(0, Math.round(finiteNumber(info.prestigeLevel ?? info.PrestigeLevel))),
    accountType: accountType(memberCategory),
    totalInGameTime: Math.max(0, finiteNumber(pmcStats.totalInGameTime)),
    equipment: equipment.length ? equipment : undefined,
    fetchedAt,
    upstreamUpdatedAt: updated > 0 ? new Date(updated).toISOString() : undefined,
  }
}

function accountType(category: number) {
  if (category === 2) return 'EOD'
  if (category === 4) return 'Unheard'
  if (category === 1) return 'Left Behind'
  return category > 0 ? `Edition ${category}` : 'Standard'
}

export function levelFromExperience(experience: number, levels: PlayerLevelRow[]) {
  const sorted = levels
    .filter((row) => Number.isFinite(row.level) && Number.isFinite(row.exp))
    .slice()
    .sort((a, b) => a.level - b.level)
  if (!sorted.length) return 1
  // playerLevels.exp is XP required to reach the next level (incremental), not a total threshold.
  let cumulative = 0
  let result = Math.max(1, sorted[0].level)
  for (const row of sorted) {
    cumulative += Math.max(0, row.exp)
    if (experience < cumulative) break
    result = Math.max(result, row.level)
  }
  return result
}

function normalizeFaction(value: unknown): PlayerProfileSnapshot['faction'] {
  const normalized = string(value).toLowerCase()
  if (normalized === 'usec') return 'usec'
  if (normalized === 'bear') return 'bear'
  return 'unknown'
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function string(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
