import { useEffect, useState } from 'react'
import { SIGHT_HEIGHT } from '../arsenal/ballistics'
import { loadPartsIndex } from '../arsenal/BuildPicture'
import type { Build } from '../arsenal/gunTypes'
import { layBuild, pointOf, type PartFrame, type PartsIndex } from '../arsenal/partPictures'

/**
 * The sight in use and its height over the bore, from the build itself (owner, 23.11.2026: «человек выбирает оружие, выбирает на нем
 * прицел, и этот прицел появляется у нас, при стрельбе, чтобы знать высоту прицела… рассчитывай уже на каждое оружие, на каждый
 * прицел высоту прицела»). The game's own points (E:\SPT-photo\range-assets\tools\sight_points.py → sights.json in the range's pack):
 * each sight's aiming camera (`mod_aim_camera`, a weapon's own `aim_camera` for its open sights), the bore through each muzzle slot
 * (or the `fireport` of a weapon or barrel without one), every part placed as «Сборка оружия» lays the build (src/arsenal/partPictures.ts).
 */
export interface SightPoints {
  /** The aiming camera of each sight and weapon, in the part's own frame (metres). */
  aim: Record<string, number[]>
  /** The fireport of a weapon or barrel without a muzzle slot. */
  bore: Record<string, number[]>
  /** The sight's class in the game (AssaultScope, OpticScope, SpecialScope, Collimator, CompactCollimator, IronSight) or Weapon. */
  kind: Record<string, string>
}

/** The open sights' order of choice without a scope: a red dot first, then the iron sights, then the weapon's own. */
const OPEN_SIGHTS = ['Collimator', 'CompactCollimator', 'IronSight', 'Weapon']
/** A height outside this (metres) is a misread, not a sight: the usual one is used instead. */
const SANE = [0.005, 0.2] as const

export interface SightLine {
  /** The sight the height is taken at (a scope's id, a red dot's, an iron sight's or the weapon's own). */
  sightId?: string
  /** The line of sight over the bore, metres. */
  height: number
  /** False: the usual 6.858 cm, as the build's sight could not be placed. */
  measured: boolean
}

/** The aiming point of a frame's sight, if the sight has one. */
const aimOf = (frame: PartFrame, points: SightPoints) => points.aim[frame.tpl] ? pointOf(frame, points.aim[frame.tpl]!) : undefined

/**
 * The sight line of a build: at `scopeId` when it is on the build (the scope the range shows), else at its open sights. The bore is
 * the first muzzle slot along the build (the barrel's or the weapon's), else a fireport.
 */
export function sightLine(build: Build, index: PartsIndex, points: SightPoints, scopeId?: string): SightLine {
  const usual: SightLine = { height: SIGHT_HEIGHT, measured: false }
  const { frames } = layBuild(build, index)
  let bore: [number, number, number] | undefined
  for (const frame of frames) {
    const slots = index.parts[frame.tpl]?.s ?? {}
    const muzzle = Object.keys(slots).find((slot) => slot.startsWith('mod_muzzle'))
    if (muzzle) { bore = pointOf(frame, slots[muzzle]!); break }
  }
  if (!bore) {
    const fired = frames.find((frame) => points.bore[frame.tpl])
    if (fired) bore = pointOf(fired, points.bore[fired.tpl]!)
  }
  if (!bore) return usual
  const scope = scopeId ? frames.find((frame) => frame.tpl === scopeId && points.aim[frame.tpl]) : undefined
  const open = scope ? undefined : OPEN_SIGHTS.map((kind) => frames.find((frame) => points.kind[frame.tpl] === kind && points.aim[frame.tpl])).find(Boolean)
  const sight = scope ?? open
  const aim = sight ? aimOf(sight, points) : undefined
  if (!sight || !aim) return usual
  const height = aim[1] - bore[1]
  if (!(height >= SANE[0] && height <= SANE[1])) return usual
  return { sightId: sight.tpl, height, measured: true }
}

/** The parts' index of «Сборка оружия» (the slot points), once loaded. */
export function usePartsIndex() {
  const [index, setIndex] = useState<PartsIndex | null>(null)
  useEffect(() => {
    let alive = true
    void loadPartsIndex().then((loaded) => { if (alive) setIndex(loaded) })
    return () => { alive = false }
  }, [])
  return index
}
