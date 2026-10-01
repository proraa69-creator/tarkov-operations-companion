import type { LocalProfile, ModeProgress, ModeRegistration, PlayerProfileSnapshot, RaidMode, TaskProgressRecord } from './types'

export const PROFILE_SCHEMA_VERSION = 5 as const

export function createModeProgress(): ModeProgress {
  return {
    registration: { status: 'unregistered' },
    playerLevel: 1,
    faction: 'unknown',
    prestige: 0,
    taskProgress: {},
    trackedTaskIds: [],
    favoriteItemIds: [],
    raidItemIds: [],
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
    modes: { pvp: createModeProgress(), pve: createModeProgress(), seasonal: createModeProgress() },
  }
}

export function registerModeProfile(
  profile: LocalProfile,
  mode: RaidMode,
  registration: Omit<ModeRegistration, 'status'> & { accountId: number; nickname: string; verifiedAt: string },
): LocalProfile {
  const current = profile.modes[mode]
  const previousAccountId = current.registration.accountId
  const accountChanged = typeof previousAccountId === 'number' && previousAccountId !== registration.accountId

  // Binding a different Tarkov account resets quest progress, but keeps operator prefs
  // (favorites / raid list / hideout) so they survive nick confirmation and wipe rebinds.
  let next = profile
  if (accountChanged) {
    next = {
      ...profile,
      modes: {
        ...profile.modes,
        [mode]: {
          ...createModeProgress(),
          favoriteItemIds: [...current.favoriteItemIds],
          raidItemIds: [...current.raidItemIds],
          hideoutLevels: { ...current.hideoutLevels },
          itemCounts: { ...(current.itemCounts ?? {}) },
        },
      },
    }
  }

  return updateMode(next, mode, {
    registration: { ...registration, status: 'registered' },
  }, registration.verifiedAt)
}

export function clearModeRegistration(profile: LocalProfile, mode: RaidMode): LocalProfile {
  return updateMode(profile, mode, {
    registration: { status: 'unregistered' },
    playerSnapshot: undefined,
  })
}

export function applyPlayerSnapshot(profile: LocalProfile, mode: RaidMode, snapshot: PlayerProfileSnapshot): LocalProfile {
  const current = profile.modes[mode].playerSnapshot
  if (current?.upstreamUpdatedAt && snapshot.upstreamUpdatedAt && snapshot.upstreamUpdatedAt < current.upstreamUpdatedAt) return profile
  if (!snapshot.upstreamUpdatedAt && current && snapshot.fetchedAt < current.fetchedAt) return profile
  return updateMode(profile, mode, {
    playerSnapshot: snapshot,
    playerLevel: Math.max(1, Math.round(snapshot.level)),
    faction: snapshot.faction,
    prestige: Math.max(0, Math.round(snapshot.prestige)),
    registration: {
      ...profile.modes[mode].registration,
      status: 'registered',
      accountId: snapshot.accountId,
      nickname: snapshot.nickname,
    },
  }, snapshot.fetchedAt)
}

export function setTaskProgress(
  profile: LocalProfile,
  mode: RaidMode,
  record: TaskProgressRecord,
): LocalProfile {
  const current = profile.modes[mode].taskProgress[record.taskId]
  if (current && current.updatedAt > record.updatedAt) return profile

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
  const candidate = input as Partial<LocalProfile> & { schemaVersion?: number; modes?: Partial<Record<RaidMode, Partial<ModeProgress>>> }
  if (!candidate.id || !candidate.displayName || !candidate.modes) return null
  const favoriteUnion = [...new Set((['pvp', 'pve', 'seasonal'] as RaidMode[]).flatMap((mode) => candidate.modes?.[mode]?.favoriteItemIds ?? []))]
  // v4 and older filled quests from screen OCR and from a log parser that could mix modes;
  // v5 rebuilds every mode from the per-mode log timeline, keeping only manual edits.
  const dropUntrusted = (candidate.schemaVersion ?? 0) < 5
  const normalizeMode = (mode: RaidMode): ModeProgress => {
    const saved = candidate.modes?.[mode]
    const taskProgress = { ...(saved?.taskProgress ?? {}) }
    for (const [taskId, record] of Object.entries(taskProgress)) {
      if (dropUntrusted && ['screen-scan', 'inferred', 'eft-log'].includes(record.source)) delete taskProgress[taskId]
      // Confirmed trader-task scans survive restart; inferred chains remain untrusted.
      else if (record.source === 'inferred') delete taskProgress[taskId]
    }
    return {
      ...createModeProgress(),
      ...(saved ?? {}),
      registration: saved?.registration?.status === 'registered'
        ? { ...saved.registration, status: 'registered' }
        : { status: 'unregistered' },
      taskProgress,
      trackedTaskIds: [...(saved?.trackedTaskIds ?? [])],
      favoriteItemIds: favoriteUnion.length ? [...favoriteUnion] : [...(saved?.favoriteItemIds ?? [])],
      raidItemIds: [...(saved?.raidItemIds ?? [])],
      hideoutLevels: { ...(saved?.hideoutLevels ?? {}) },
      itemCounts: Object.fromEntries(Object.entries(saved?.itemCounts ?? {})
        .filter(([, count]) => typeof count === 'number' && Number.isFinite(count) && count > 0)
        .map(([itemId, count]) => [itemId, Math.round(count)])),
    }
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id: candidate.id,
    displayName: candidate.displayName,
    createdAt: candidate.createdAt ?? new Date().toISOString(),
    updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    selectedMode: candidate.selectedMode === 'pve' || candidate.selectedMode === 'seasonal' ? candidate.selectedMode : 'pvp',
    modes: { pvp: normalizeMode('pvp'), pve: normalizeMode('pve'), seasonal: normalizeMode('seasonal') },
  }
}

function updateMode(profile: LocalProfile, mode: RaidMode, patch: Partial<ModeProgress>, updatedAt = new Date().toISOString()): LocalProfile {
  return {
    ...profile,
    updatedAt,
    modes: { ...profile.modes, [mode]: { ...profile.modes[mode], ...patch } },
  }
}
