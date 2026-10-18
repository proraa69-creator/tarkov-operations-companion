import type { SlotKind } from './boardLayout'

/**
 * What an empty slot shows (owner, 17.10.2026: «внутренние силуэты модулей, где нет модулей … скопируй с сайта»): the
 * game's own empty-slot pictures from the weapon modding screen (src/assets/slots, taken from db4tarkov, which uses the
 * game's), with the slot's name drawn in. A slot the game has no picture for (the ammo cell, an unknown slot) gets a
 * simple outline of our own on a 48 × 24 box.
 */
const PICTURES = import.meta.glob<string>('../assets/slots/*.png', { eager: true, query: '?url', import: 'default' })
const picture = (name: string) => PICTURES[`../assets/slots/${name}.png`]

/** The game's picture for a slot, by its nameId first (rear/front sight, light, NVG, catch…), then by its kind. */
export function slotPicture(nameId: string, kind: SlotKind): string | undefined {
  const id = nameId.toLowerCase()
  const byName = id.includes('sight_rear') ? 'sight_rear' : id.includes('sight_front') ? 'sight_front' : id.includes('flashlight') ? 'flashlight'
    : id.includes('nvg') ? 'nvg' : id.includes('catch') ? 'catch' : id.includes('hammer') ? 'hammer' : id.includes('trigger') ? 'trigger'
      : id.includes('equipment') ? 'equipment' : undefined
  const byKind: Partial<Record<SlotKind, string>> = {
    muzzle: 'muzzle', gas: 'gas_block', barrel: 'barrel', handguard: 'handguard', receiver: 'reciever', stock: 'stock', magazine: 'magazine',
    grip: 'pistol_grip', charge: 'charge', sight: 'sight_front', scope: 'scope', mount: 'mount', foregrip: 'foregrip', bipod: 'bipod',
    tactical: 'tactical', launcher: 'launcher',
  }
  return picture(byName ?? byKind[kind] ?? '')
}
