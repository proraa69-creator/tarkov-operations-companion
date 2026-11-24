import type { GunPart } from './gunTypes'

/**
 * Weapon part stats the game changed in a patch before tarkov.dev caught up (owner, 17.10.2026: «по актуальности модулей
 * делай так, ищи сам после патча, где есть актуальные данные, или … сам буду искать и скидывать»).
 *
 * Each fix keeps the value tarkov.dev had when the fix was added (`was`) and the value in the game (`now`). It applies
 * only while tarkov.dev still has `was`: once tarkov.dev updates the item — to the same number or to a newer one — the
 * fix stops on its own, so a stale fix never overrides fresher data. Recoil is in percent as the game shows it (−8.1),
 * ergonomics in points, weight in kg.
 *
 * To add a patch: a new set on top with its game version, where the numbers come from and the date; one line per item.
 */
export interface PatchFix {
  id: string
  /** Russian name, for the reader of this file only. */
  name: string
  recoil?: { was: number; now: number }
  ergonomics?: { was: number; now: number }
  weight?: { was: number; now: number }
}

export interface PatchFixSet {
  patch: string
  source: string
  addedAt: string
  fixes: PatchFix[]
}

/**
 * No fix stands today. The set of 17.10.2026 (ten parts: the MIAD and Stark grips, Ravage stocks, P90 parts) is gone (owner,
 * 06.11.2026: «имеет +6 эргономики, а не +3»): it had the patch of 18.09.2026 backwards, the numbers before that patch as
 * the new ones, so tarkov.dev was right all along. Checked on 06.11.2026 against the wiki and eftarkov.com (game 1.2.5.0).
 * Before adding a set, read which way the numbers went and check them in the game or in a second source.
 */
export const PATCH_FIXES: PatchFixSet[] = []

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** The part with the patch fixes that still apply (the part itself when none does). */
export function fixedPart<T extends GunPart>(part: T, sets: PatchFixSet[] = PATCH_FIXES): T {
  let next = part
  for (const set of sets) {
    const fix = set.fixes.find((entry) => entry.id === part.id)
    if (!fix) continue
    if (fix.recoil && same(next.recoilModifier * 100, fix.recoil.was)) next = { ...next, recoilModifier: fix.recoil.now / 100 }
    if (fix.ergonomics && same(next.ergonomics, fix.ergonomics.was)) next = { ...next, ergonomics: fix.ergonomics.now }
    if (fix.weight && same(next.weight, fix.weight.was)) next = { ...next, weight: fix.weight.now }
  }
  return next
}

/** Applies the fixes to a whole mod catalogue (a new map; parts without a fix are shared). */
export function applyPatchFixes(mods: Map<string, GunPart>, sets: PatchFixSet[] = PATCH_FIXES): Map<string, GunPart> {
  const ids = new Set(sets.flatMap((set) => set.fixes.map((fix) => fix.id)))
  return new Map([...mods].map(([id, part]) => [id, ids.has(id) ? fixedPart(part, sets) : part]))
}
