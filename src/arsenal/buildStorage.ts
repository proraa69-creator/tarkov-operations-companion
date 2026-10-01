import type { RaidMode } from '../domain/types'
import { emptyNode } from './buildModel'
import type { Build, BuildNode, GunCatalog, GunPart } from './gunTypes'

/**
 * Share code of a build: «RB1.<weapon>.<ammo>.<tree>».
 * Ids (24 hex chars) are written as 16 base64url chars; a slot is written as its index in the parent's slot list
 * (one base36 char), followed by the item id and, in brackets, its own slots. A typical 12-part build is ~250 chars.
 * Decoding checks every item against the slot's allowedItems, so a code from another data version loads what still fits.
 */
const PREFIX = 'RB1'
const HEX_ID = /^[0-9a-f]{24}$/
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function hexToB64(hex: string): string {
  let bits = ''
  for (const char of hex) bits += Number.parseInt(char, 16).toString(2).padStart(4, '0')
  let out = ''
  for (let index = 0; index < bits.length; index += 6) out += B64[Number.parseInt(bits.slice(index, index + 6), 2)]
  return out
}

export function b64ToHex(value: string): string {
  let bits = ''
  for (const char of value) {
    const index = B64.indexOf(char)
    if (index < 0) return ''
    bits += index.toString(2).padStart(6, '0')
  }
  let out = ''
  for (let index = 0; index < bits.length; index += 4) out += Number.parseInt(bits.slice(index, index + 4), 2).toString(16)
  return out
}

type Lookup = Pick<GunCatalog, 'weapons' | 'mods'>

export function encodeBuild(build: Build, catalog: Lookup): string | undefined {
  const weapon = catalog.weapons.find((entry) => entry.id === build.weaponId)
  if (!weapon || !HEX_ID.test(weapon.id)) return undefined
  const encodeNode = (part: GunPart, node: BuildNode): string => part.slots.map((slot, index) => {
    const child = node.children[slot.nameId]
    const childPart = child ? catalog.mods.get(child.itemId) : undefined
    if (!child || !childPart || index >= 36 || !HEX_ID.test(child.itemId)) return ''
    const inner = encodeNode(childPart, child)
    return `${index.toString(36)}${hexToB64(child.itemId)}${inner ? `(${inner})` : ''}`
  }).join('')
  const ammo = build.ammoId && HEX_ID.test(build.ammoId) ? hexToB64(build.ammoId) : ''
  return `${PREFIX}.${hexToB64(weapon.id)}.${ammo}.${encodeNode(weapon, build.root)}`
}

export function decodeBuild(code: string, catalog: Lookup): Build | undefined {
  const match = code.trim().match(/RB1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{16})?\.([A-Za-z0-9_()-]*)/)
  if (!match) return undefined
  const weapon = catalog.weapons.find((entry) => entry.id === b64ToHex(match[1]))
  if (!weapon) return undefined
  const tree = match[3]
  let cursor = 0
  const parseInto = (part: GunPart | undefined, node: BuildNode) => {
    while (cursor < tree.length && tree[cursor] !== ')') {
      const index = Number.parseInt(tree[cursor], 36)
      const itemId = b64ToHex(tree.slice(cursor + 1, cursor + 17))
      cursor += 17
      const slot = part?.slots[index]
      const childPart = catalog.mods.get(itemId)
      const fits = Boolean(slot && childPart && slot.allowed.includes(itemId))
      const child = emptyNode(itemId)
      if (tree[cursor] === '(') {
        cursor += 1
        parseInto(fits ? childPart : undefined, child)
        cursor += 1
      }
      if (fits && slot) node.children[slot.nameId] = child
    }
  }
  const root = emptyNode(weapon.id)
  parseInto(weapon, root)
  return { weaponId: weapon.id, root, ammoId: match[2] ? b64ToHex(match[2]) : weapon.defaultAmmoId }
}

export interface SavedBuild {
  id: string
  name: string
  weaponId: string
  code: string
  savedAt: string
}

const STORAGE_KEY = 'raid-os-gun-builds-v1'
type SavedByMode = Partial<Record<RaidMode, SavedBuild[]>>

function readAll(): SavedByMode {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SavedByMode : {}
  } catch {
    return {}
  }
}

function writeAll(value: SavedByMode) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* private mode / quota: builds stay in memory only */ }
}

/** Saved builds of one mode only — PvP, PvE and Season lists never mix. */
export function loadSavedBuilds(mode: RaidMode): SavedBuild[] {
  const list = readAll()[mode]
  return Array.isArray(list) ? list.filter((entry) => entry && typeof entry.code === 'string') : []
}

export function saveBuild(mode: RaidMode, entry: Omit<SavedBuild, 'id' | 'savedAt'> & { id?: string }): SavedBuild[] {
  const all = readAll()
  const saved: SavedBuild = { ...entry, id: entry.id ?? `b${Date.now().toString(36)}`, savedAt: new Date().toISOString() }
  const list = [saved, ...(all[mode] ?? []).filter((existing) => existing.id !== saved.id)].slice(0, 50)
  writeAll({ ...all, [mode]: list })
  return list
}

export function deleteSavedBuild(mode: RaidMode, id: string): SavedBuild[] {
  const all = readAll()
  const list = (all[mode] ?? []).filter((entry) => entry.id !== id)
  writeAll({ ...all, [mode]: list })
  return list
}
