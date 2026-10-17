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

export const PATCH_FIXES: PatchFixSet[] = [
  {
    patch: '1.1.5.1.47510',
    source: 'db4tarkov patch changes (json/core/changes.json), compared with json.tarkov.dev on 17.10.2026; not checked in game',
    addedAt: '2026-10-17',
    fixes: [
      { id: '5cc701d7e4a94900100ac4e7', name: 'Ствол 407мм для FN P90 5.7x28', recoil: { was: -17.1, now: -8.1 }, ergonomics: { was: -16.5, now: -14 } },
      { id: '5cc700b9e4a949000f0f0f25', name: 'Приклад для FN P90', recoil: { was: -5, now: -6 }, ergonomics: { was: 26.5, now: 26 } },
      { id: '5cebec10d7f00c065703d185', name: 'Приклад для FN PS90', recoil: { was: -5, now: -6 }, ergonomics: { was: 26.5, now: 26 } },
      { id: '5cc700d4e4a949000f0f0f28', name: 'Затыльник приклада Damage Industries для FN P90', recoil: { was: -3, now: -2 }, ergonomics: { was: 1.5, now: 2 } },
      { id: '59db3acc86f7742a2c4ab912', name: 'Пистолетная рукоятка Stark "AR Rifle Grip" для AR-15 (Черная)', recoil: { was: -1.2, now: -1.5 }, ergonomics: { was: 6, now: 5 } },
      { id: '59db3b0886f77429d72fb895', name: 'Пистолетная рукоятка Stark "AR Rifle Grip" для AR-15 (FDE)', recoil: { was: -1.2, now: -1.5 }, ergonomics: { was: 6, now: 5 } },
      { id: '5a339805c4a2826c6e06d73d', name: 'Пистолетная рукоятка Magpul "MIAD" для AR-15 (FDE)', recoil: { was: -1.2, now: -1 }, ergonomics: { was: 6, now: 3 } },
      { id: '6984b82c5aab442620032fe8', name: 'Приклад Lead Star Arms "Ravage" для AR-15', recoil: { was: -17, now: -19 }, ergonomics: { was: 20, now: 19 } },
      { id: '6985ec9fc848f05f4600f6b9', name: 'Приклад Lead Star Arms "Ravage" для AR-15 (Красный)', recoil: { was: -17, now: -19 }, ergonomics: { was: 20, now: 19 } },
      { id: '6985eca7de77dd8dd50025ba', name: 'Приклад Lead Star Arms "Ravage" для AR-15 (Желтый)', recoil: { was: -17, now: -19 }, ergonomics: { was: 20, now: 19 } },
    ],
  },
]

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
