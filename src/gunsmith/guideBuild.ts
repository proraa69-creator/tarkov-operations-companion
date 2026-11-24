import { installReplacing, presetBuild } from '../arsenal/buildModel'
import { placePart } from './gunsmithSolver'
import type { Build, BuildNode, GunCatalog, GunPart, GunSlot, Weapon } from '../arsenal/gunTypes'

/**
 * A Gunsmith task's build as the guide shows it on its screenshot (owner, 20.11.2026: «сборку собирая в точности по скриншотам
 * оружия»): the guide (tarkov.help) lists only the parts to buy, never the weapon's own; so the weapon's default build, then every
 * listed part in a slot that takes it, taking off the default part there or what it does not go with. Rounds until nothing moves: a
 * mount goes in before the sight on it. A slot on a listed part is tried first (the sight on the guide's mount, not on the receiver's
 * rail), then an empty one, then one holding a default part; a listed part is never taken off for another. Only when every listed
 * part with a slot of its own is in, one with no slot anywhere on the build goes in through a mount or an adapter (as «Как собрать»,
 * src/gunsmith/gunsmithSolver.ts). `unplaced`: listed parts with no place — mostly a second choice for a slot already taken
 * (the guide lists two magazines that both pass).
 */
export function assembleGuideBuild(weapon: Weapon, partIds: readonly string[], catalog: Pick<GunCatalog, 'mods'> | GunCatalog): { build: Build; unplaced: string[] } {
  let build = presetBuild(weapon, catalog).build
  const placed = new Map<string, string>()
  const key = (path: string[]) => path.join('/')
  const keeps = (next: Build) => [...placed].every(([path, item]) => itemAt(next, path.split('/')) === item)
  let pending = partIds.filter((id) => id !== weapon.id && catalog.mods.has(id))

  /** Every pending part that has a free slot of its own; true when one went in. */
  const direct = () => {
    let moved = false
    pending = pending.filter((id) => {
      const spots = slotsOf(build, weapon, catalog)
        .filter((spot) => spot.slot.allowed.includes(id) && !placed.has(key(spot.path)))
        .sort((a, b) => rank(a, placed) - rank(b, placed))
      for (const spot of spots) {
        const result = installReplacing(build, spot.path, spot.slot, id, catalog, weapon)
        if (!result || !keeps(result.build)) continue
        build = result.build
        placed.set(key(spot.path), id)
        moved = true
        return false
      }
      return true
    })
    return moved
  }
  /** The first pending part with no slot anywhere on the build, through a mount or an adapter; true when it went in. */
  const through = () => {
    if (!('weapons' in catalog)) return false
    const tryInstall = (from: Build, path: string[], slot: GunSlot, itemId: string) => installReplacing(from, path, slot, itemId, catalog, weapon)?.build ?? null
    for (const id of pending) {
      if (slotsOf(build, weapon, catalog).some((spot) => spot.slot.allowed.includes(id))) continue
      const result = placePart(build, weapon, catalog, id, [...placed.keys()].map((path) => path.split('/')), tryInstall, () => 0)
      if (!result || !keeps(result.build)) continue
      build = result.build
      placed.set(key(result.path), id)
      pending = pending.filter((entry) => entry !== id)
      return true
    }
    return false
  }
  for (let round = 0; round < 12 && pending.length; round++) if (!direct() && !through()) break
  return { build, unplaced: pending }
}

interface Spot { path: string[]; slot: GunSlot; holder?: string }

/** Every slot of the parts on the weapon, with what is in it. */
function slotsOf(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>): Spot[] {
  const out: Spot[] = []
  const walk = (owner: GunPart, node: BuildNode, path: string[]) => {
    for (const slot of owner.slots) {
      const child = node.children[slot.nameId]
      const slotPath = [...path, slot.nameId]
      out.push({ path: slotPath, slot, holder: child?.itemId })
      const part = child ? catalog.mods.get(child.itemId) : undefined
      if (part && child) walk(part, child, slotPath)
    }
  }
  walk(weapon, build.root, [])
  return out
}

/** On a listed part first, then an empty slot, then one with a default part in it. */
function rank(spot: Spot, placed: Map<string, string>) {
  const onListed = [...placed.keys()].some((path) => spot.path.join('/').startsWith(`${path}/`))
  return (onListed ? 0 : 2) + (spot.holder ? 1 : 0)
}

function itemAt(build: Build, path: string[]): string | undefined {
  let node: BuildNode | undefined = build.root
  for (const id of path) node = node?.children[id]
  return node?.itemId
}
