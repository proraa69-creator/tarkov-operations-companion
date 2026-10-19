import { useEffect, useState } from 'react'
import type { BossGear, BossInfo, MapMarker } from '../domain/types'
import { dataRoute } from './tarkovApi'
import { loadTarkovDataset } from './tarkovDataset'
import { buildLegacyBosses } from './tarkovJsonAdapters'

const CACHE_KEY = 'toc.bosses.graphql.v2'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const GEAR_SLOTS = ['FirstPrimaryWeapon', 'SecondPrimaryWeapon', 'Holster', 'Headwear', 'ArmorVest', 'TacticalVest']

export interface BossProfile {
  key: string
  name: string
  aliases?: string[]
  portraitUrl?: string
  gear?: BossGear[]
  health?: number
}

/**
 * Offline fallback built from json.tarkov.dev `mobs` (same upstream as GraphQL `bosses`).
 * Portrait URLs were checked to return HTTP 200. Gear is tarkov.dev's estimate of typical loadout.
 */
export const STATIC_BOSSES: BossProfile[] = [
  { key: 'reshala', name: 'Решала', aliases: ['Reshala'], health: 752, gear: gear('АК-101', 'ТТ Золотой') },
  { key: 'killa', name: 'Килла', aliases: ['Killa'], health: 890, gear: gear('РПК-16', 'ТТ', 'Маска-1Щ (KE)', '6Б13 KE') },
  { key: 'glukhar', name: 'Глухарь', aliases: ['Glukhar'], health: 1010, gear: gear('АШ-12', 'СР-3М', 'ПЛ-15', 'DA Bastion', 'Thunderbolt') },
  { key: 'shturman', name: 'Штурман', aliases: ['Shturman'], health: 812, gear: gear('СВДС', 'АК-105') },
  { key: 'tagilla', name: 'Тагилла', aliases: ['Tagilla'], health: 1220, gear: gear('АКС-74УН', 'Strandhogg') },
  { key: 'sanitar', name: 'Санитар', aliases: ['Sanitar'], health: 1270, gear: gear('СР-3М', 'АПС') },
  { key: 'kaban', name: 'Кабан', aliases: ['Kaban'], health: 1300, gear: gear('ПКП', 'СР-1МП') },
  { key: 'kollontay', name: 'Колонтай', aliases: ['Коллонтай', 'Kollontay'], health: 1055, gear: gear('РПДН', 'ПЛ-15') },
  { key: 'partisan', name: 'Партизан', aliases: ['Partisan'], health: 950, gear: gear('АКС-74', 'МЦ-255-12', 'АПС') },
  { key: 'zryachiy', name: 'Зрячий', aliases: ['Zryachiy'], health: 1655, gear: gear('СВДС', 'АКС-74У', 'СР-1МП') },
  { key: 'cultist-priest', name: 'Жрец', aliases: ['Cultist Priest', 'Жрец культа', 'sectantPriest'], health: 850, gear: gear('Нож культиста') },
  { key: 'knight', name: 'Knight', aliases: ['Рыцарь'], health: 1120, gear: gear('SPEAR 6.8', 'Glock 17', 'CPC GE') },
  { key: 'big-pipe', name: 'Big Pipe', aliases: ['Биг Пайп'], health: 910, gear: gear('MCX .300 BLK', 'M870', 'M45A1') },
  { key: 'birdeye', name: 'Birdeye', aliases: ['Бёрдай', 'Птичий глаз'], health: 795, gear: gear('M4A1', 'M9A3', 'THOR CRV') },
]

let memoryProfiles: BossProfile[] | null = null
let pending: Promise<BossProfile[] | null> | null = null
let failed = false

export function resolveBossInfo(marker: MapMarker, remote: BossProfile[] | null): BossInfo {
  const base: BossInfo = marker.boss ?? { name: marker.title }
  const profile = findProfile(remote, base) ?? findProfile(STATIC_BOSSES, base)
  if (!profile) return base
  return {
    ...base,
    key: base.key ?? profile.key,
    name: base.name || profile.name,
    portraitUrl: base.portraitUrl ?? profile.portraitUrl,
    gear: base.gear?.length ? base.gear : profile.gear,
    health: base.health ?? profile.health,
  }
}

/** Loads boss profiles from the Raid OS JSON mirror once per session. Returns null until/unless available. */
export function useBossProfiles(enabled: boolean) {
  const [profiles, setProfiles] = useState<BossProfile[] | null>(() => memoryProfiles ?? readCache())
  useEffect(() => {
    if (!enabled || profiles || failed) return
    let alive = true
    void loadBossProfiles().then((result) => {
      if (alive && result) setProfiles(result)
    })
    return () => { alive = false }
  }, [enabled, profiles])
  return profiles
}

export function loadBossProfiles(): Promise<BossProfile[] | null> {
  if (memoryProfiles) return Promise.resolve(memoryProfiles)
  const cached = readCache()
  if (cached) {
    memoryProfiles = cached
    return Promise.resolve(cached)
  }
  if (failed || typeof fetch !== 'function') return Promise.resolve(null)
  pending ??= fetchBossProfiles()
    .then((profiles) => {
      memoryProfiles = profiles
      writeCache(profiles)
      return profiles
    })
    .catch(() => {
      failed = true
      return null
    })
    .finally(() => { pending = null })
  return pending
}

export function adaptGraphqlBosses(payload: unknown): BossProfile[] {
  const bosses = (payload as { data?: { bosses?: unknown } })?.data?.bosses
  if (!Array.isArray(bosses)) return []
  return bosses.flatMap((raw) => {
    const boss = raw as Record<string, unknown>
    const key = typeof boss.normalizedName === 'string' ? boss.normalizedName : ''
    const name = typeof boss.name === 'string' ? boss.name : ''
    if (!key || !name) return []
    const equipment = Array.isArray(boss.equipment) ? boss.equipment as Array<Record<string, unknown>> : []
    const gearList = GEAR_SLOTS.flatMap((slot) => {
      const entry = equipment.find((candidate) => (Array.isArray(candidate.attributes) ? candidate.attributes : [])
        .some((attribute: { name?: string; value?: string }) => attribute?.name === 'slot' && attribute.value === slot))
      const item = entry?.item as { name?: string; shortName?: string; iconLink?: string; properties?: { defaultPreset?: { iconLink?: string } | null } | null } | undefined
      const itemName = item?.shortName || item?.name
      // a weapon shows its default preset (the whole gun), not the bare receiver
      const icon = item?.properties?.defaultPreset?.iconLink || item?.iconLink
      return itemName ? [{ name: itemName, iconUrl: icon || undefined, slot }] : []
    })
    const health = (Array.isArray(boss.health) ? boss.health as Array<{ max?: number }> : []).reduce((sum, part) => sum + (Number(part?.max) || 0), 0)
    return [{
      key,
      name,
      portraitUrl: typeof boss.imagePortraitLink === 'string' ? boss.imagePortraitLink : undefined,
      gear: gearList.length ? gearList : undefined,
      health: health || undefined,
    }]
  })
}

async function fetchBossProfiles() {
  const profiles = adaptGraphqlBosses({ data: { bosses: buildLegacyBosses(await loadTarkovDataset('pvp', 'ru')) } })
  if (!profiles.length) throw new Error('bosses: empty response')
  return profiles
}

function findProfile(list: BossProfile[] | null, info: BossInfo) {
  if (!list?.length) return undefined
  const name = normalize(info.name)
  return list.find((profile) => (info.key && profile.key === info.key)
    || normalize(profile.name) === name
    || profile.aliases?.some((alias) => normalize(alias) === name))
}

function readCache(): BossProfile[] | null {
  // The players' app keeps game data only in the encrypted cache (docs/subscription-protection.md): memory here.
  if (dataRoute() === 'gateway') return null
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt: number; profiles: BossProfile[] }
    if (!Array.isArray(parsed.profiles) || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null
    return parsed.profiles
  } catch {
    return null
  }
}

function writeCache(profiles: BossProfile[]) {
  if (dataRoute() === 'gateway') return
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), profiles }))
  } catch {
    // Storage may be full or unavailable; the in-memory copy is enough.
  }
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, 'е')
}

function gear(...names: string[]): BossGear[] {
  return names.map((name) => ({ name }))
}
