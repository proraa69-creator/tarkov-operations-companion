import type { LocalProfile, ModeProgress, RaidMode, TaskProgressRecord } from './types'

export const PROFILE_SCHEMA_VERSION = 2 as const

export function createModeProgress(): ModeProgress {
  return {
    playerLevel: 1,
    faction: 'unknown',
    prestige: 0,
    taskProgress: {},
    trackedTaskIds: [],
    favoriteItemIds: [],
    hideoutLevels: {},
  }
}

export function createLocalProfile(displayName: string, id: string = crypto.randomUUID()): LocalProfile {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id,
    displayName: displayName.trim() || 'Оператор',
    createdAt: now,
    updatedAt: now,
    selectedMode: 'pvp',
    modes: { pvp: createModeProgress(), pve: createModeProgress() },
  }
}

export function setTaskProgress(
  profile: LocalProfile,
  mode: RaidMode,
  record: TaskProgressRecord,
): LocalProfile {
  const current = profile.modes[mode].taskProgress[record.taskId]
  if (current?.status === 'completed' && record.status !== 'completed' && record.source !== 'manual') return profile

  return {
    ...profile,
    updatedAt: record.updatedAt,
    modes: {
      ...profile.modes,
      [mode]: {
        ...profile.modes[mode],
        taskProgress: { ...profile.modes[mode].taskProgress, [record.taskId]: record },
      },
    },
  }
}

export function migrateProfile(input: unknown): LocalProfile | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<LocalProfile>
  if (!candidate.id || !candidate.displayName || !candidate.modes) return null
  const normalizeMode = (mode: RaidMode): ModeProgress => ({
    ...createModeProgress(),
    ...(candidate.modes?.[mode] ?? {}),
    taskProgress: { ...(candidate.modes?.[mode]?.taskProgress ?? {}) },
  })
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id: candidate.id,
    displayName: candidate.displayName,
    createdAt: candidate.createdAt ?? new Date().toISOString(),
    updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    selectedMode: candidate.selectedMode === 'pve' ? 'pve' : 'pvp',
    modes: { pvp: normalizeMode('pvp'), pve: normalizeMode('pve') },
  }
}
