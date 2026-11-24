import { installReplacing, slotCandidates } from './buildModel'
import type { Build, GunCatalog, GunPart, GunSlot } from './gunTypes'

/**
 * «Комплекты: дульник + глушитель» (owner, 01.11.2026: «комплекты дульник + глушитель, те которые подходят друг к другу,
 * что бы видеть сколько дает параметров в сборе, по нажатию на комплект, сразу добавляется в сборку два предмета»): every
 * muzzle device of a muzzle slot with every suppressor its own muzzle slot takes, both installed (what they replace comes
 * off, as for one part).
 */
export interface MuzzleKit { device: GunPart; suppressor: GunPart; build: Build; removed: GunPart[] }

const MUZZLE_SLOT = /^mod_muzzle/
const isSuppressor = (part: GunPart) => part.category === 'silencer'

export const isMuzzleSlot = (slot: Pick<GunSlot, 'nameId'>) => MUZZLE_SLOT.test(slot.nameId)

export function muzzleKits(build: Build, path: string[], slot: GunSlot, catalog: Pick<GunCatalog, 'mods'>, root?: GunPart): MuzzleKit[] {
  if (!isMuzzleSlot(slot)) return []
  const kits: MuzzleKit[] = []
  for (const device of slotCandidates(slot, catalog)) {
    if (isSuppressor(device)) continue
    const own = device.slots.find(isMuzzleSlot)
    if (!own) continue
    const suppressors = slotCandidates(own, catalog).filter(isSuppressor)
    if (!suppressors.length) continue
    const first = installReplacing(build, path, slot, device.id, catalog, root)
    if (!first) continue
    for (const suppressor of suppressors) {
      const second = installReplacing(first.build, [...path, own.nameId], own, suppressor.id, catalog, root)
      if (second) kits.push({ device, suppressor, build: second.build, removed: [...first.removed, ...second.removed] })
    }
  }
  return kits
}
