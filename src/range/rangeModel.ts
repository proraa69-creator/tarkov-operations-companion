/**
 * «Тир» (owner, 22.11.2026: «https://tarkov-lab.com/#range — изучи всю систему … сделай так же у нас»): what one bullet does to a
 * character in armour, the way the game itself does it. Pure functions (see rangeModel.test.ts).
 *
 * Read from the game's client code (Assembly-CSharp of the offline SPT copy, 22.11.2026; read only, nothing run or changed):
 *  - ShotSharedMethods.RealResistance: durability d % = durability / max × 100; resistance R = (121 − 5000/(45 + 2d)) × class
 *    resistance × 0.01, the class resistance being class × 10 (globals `armor.class`); CF = clamp(pen / (R + 12), 0.6, 1).
 *  - ArmorResistanceData.GetPenetrationChance (percent): R ≥ p + 15 → 0; R ≥ p → 0.4·(R − p − 15)²; R ≤ p − 15 → 100;
 *    else 100 + p / (0.9R − p). The shot is stopped when chance − random·100 < 0 (ArmorComponent.SetPenetrationStatus).
 *  - Player.SetShotStatus: every armour piece over the hit spot in turn — a ricochet (Deflects) ends the hit, else a piece
 *    rolls while none has stopped the bullet yet. Removable pieces come before built-in ones (Inventory.OrderLockedLast).
 *  - Player.ProceedDamageThroughArmor / ArmorComponent.ApplyDamage, piece by piece up to the one that stopped or deflected it:
 *      a ricochet halves damage, armour damage and penetration first;
 *      gone through: damage × CF, penetration × CF, durability − pen(after) × armour damage × clamp(pen(before)/(class×10), 0.5, 0.9) × destructibility;
 *      stopped: durability − pen × armour damage × clamp(pen/(class×10), 0.6, 1.1) × destructibility, damage × blunt throughput
 *        × clamp(1 − 0.03·(R − pen), 0.2, 1); a plate over soft armour (slot flag `bluntDamageReduceFromSoftArmor`) has its
 *        blunt throughput × 0.6 (globals `BluntDamageReduceFromSoftArmorMod`);
 *      every piece after the one that stopped it: damage × its blunt throughput;
 *      at least 1 point of durability per hit; a piece at 0 durability does nothing.
 *    A plate is a collider of its own in front of the body: gone through, it deals the body nothing itself, and the bullet goes
 *    on with damage and penetration × CF (Shot.ApplyPenetratedDegradation) to the body collider and the soft armour there.
 *  - ArmorComponent.Deflects: angle a between the shot and the surface normal; above the piece's ricochet angle z the chance is
 *    lerp(x, y, inverseLerp(90, z, a)).
 *  - BallisticsCalculator.GetAmmoPenetrationPower: the round's penetration ~ normal(penetration, deviation) per shot.
 *  - ActiveHealthController.ApplyDamage: the part loses the damage (not below 0); a part at 0 is destroyed and a destroyed head
 *    or thorax kills; what the part could not take (damage − its health before) × the part's over-damage factor (stomach 1.5,
 *    arms 0.7, legs 1; globals `StomachOverdamage`, `HandsOverdamage`, `LegsOverdamage`) is shared among the other living parts
 *    by their maximum health, each taking its share × 0.7 (`OverDamageReceivedMultiplier`); a part brought to 0 that way is
 *    destroyed too.
 * Not modelled: fragmentation (the game now spawns fragments as shots of their own), skills, bleeding and fractures.
 */

export const BODY_PARTS = ['Head', 'Chest', 'Stomach', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'] as const
export type BodyPart = (typeof BODY_PARTS)[number]
export type Health = Record<BodyPart, number>

/** The game's hit colliders (EBodyPartColliderType). */
export const COLLIDERS = [
  'HeadCommon', 'ParietalHead', 'BackHead', 'Ears', 'Eyes', 'Jaw', 'NeckFront', 'NeckBack',
  'RibcageUp', 'SpineTop', 'LeftSideChestUp', 'RightSideChestUp',
  'RibcageLow', 'SpineDown', 'LeftSideChestDown', 'RightSideChestDown', 'Pelvis', 'PelvisBack',
  'LeftUpperArm', 'LeftForearm', 'RightUpperArm', 'RightForearm', 'LeftThigh', 'LeftCalf', 'RightThigh', 'RightCalf',
] as const
export type Collider = (typeof COLLIDERS)[number]

/** The game's plate colliders (EArmorPlateCollider). */
export const PLATE_ZONES = [
  'Plate_Granit_SAPI_chest', 'Plate_Granit_SAPI_back', 'Plate_Korund_chest', 'Plate_6B13_back',
  'Plate_Granit_SSAPI_side_left_high', 'Plate_Granit_SSAPI_side_left_low', 'Plate_Granit_SSAPI_side_right_high', 'Plate_Granit_SSAPI_side_right_low',
  'Plate_Korund_side_left_high', 'Plate_Korund_side_left_low', 'Plate_Korund_side_right_high', 'Plate_Korund_side_right_low',
] as const
export type PlateZone = (typeof PLATE_ZONES)[number]

/**
 * Which body part a collider's damage goes to — the game's player model (its BodyPartCollider components, read in the offline copy
 * 22.11.2026): the neck counts to the thorax, the groin to the stomach.
 */
export const COLLIDER_PART: Record<Collider, BodyPart> = {
  HeadCommon: 'Head', ParietalHead: 'Head', BackHead: 'Head', Ears: 'Head', Eyes: 'Head', Jaw: 'Head',
  NeckFront: 'Chest', NeckBack: 'Chest',
  RibcageUp: 'Chest', SpineTop: 'Chest', LeftSideChestUp: 'Chest', RightSideChestUp: 'Chest',
  RibcageLow: 'Stomach', SpineDown: 'Stomach', LeftSideChestDown: 'Stomach', RightSideChestDown: 'Stomach', Pelvis: 'Stomach', PelvisBack: 'Stomach',
  LeftUpperArm: 'LeftArm', LeftForearm: 'LeftArm', RightUpperArm: 'RightArm', RightForearm: 'RightArm',
  LeftThigh: 'LeftLeg', LeftCalf: 'LeftLeg', RightThigh: 'RightLeg', RightCalf: 'RightLeg',
}

/** The body part a plate collider passes a stopped bullet's blow to (the game's model: the side plates sit on the stomach). */
export function platePart(zone: PlateZone): BodyPart {
  return zone.includes('_side_') ? 'Stomach' : 'Chest'
}

/** One protecting piece: a plate, a soft insert, a helmet's part, a face shield, armoured glasses. */
export interface ArmorPiece {
  /** Unique in the kit (`armor:Front_plate`, `helmet:Helmet_top`). */
  key: string
  itemId: string
  name: string
  armorClass: number
  maxDurability: number
  /** Current durability (the kit's state; shots lower it). */
  durability: number
  material: string
  destructibility: number
  bluntThroughput: number
  /** Ricochet: x the chance at a right angle… y at the ricochet angle z (degrees between the shot and the normal). */
  ricochet?: { x: number; y: number; z: number }
  colliders: Collider[]
  plates: PlateZone[]
  /** A plate over soft armour: its blunt throughput × 0.6. */
  softReduce?: boolean
  /** Removable pieces are hit before built-in ones. */
  removable: boolean
}

export interface Round {
  damage: number
  penetration: number
  /** Armour damage as a fraction (the game's ArmorDamage % / 100). */
  armorDamage: number
  penetrationDeviation?: number
}

export const BLUNT_SOFT_ARMOR_FACTOR = 0.6
export const OVER_DAMAGE_FACTOR: Record<BodyPart, number> = { Head: 1, Chest: 1, Stomach: 1.5, LeftArm: 0.7, RightArm: 0.7, LeftLeg: 1, RightLeg: 1 }
export const OVER_DAMAGE_RECEIVED = 0.7

export const PMC_HEALTH: Health = { Head: 35, Chest: 85, Stomach: 70, LeftArm: 60, RightArm: 60, LeftLeg: 65, RightLeg: 65 }

export function classResistance(armorClass: number) {
  return armorClass > 0 ? armorClass * 10 : 1
}

/** The game's effective resistance at a durability (ShotSharedMethods.RealResistance). */
export function realResistance(armorClass: number, durability: number, maxDurability: number) {
  const percent = maxDurability > 0 ? durability / maxDurability * 100 : 0
  return (121 - 5000 / (45 + percent * 2)) * classResistance(armorClass) * 0.01
}

/** Penetration chance in percent (ArmorResistanceData.GetPenetrationChance). */
export function penetrationChancePercent(resistance: number, penetration: number) {
  if (resistance >= penetration + 15) return 0
  if (resistance >= penetration) return 0.4 * (resistance - penetration - 15) ** 2
  if (resistance <= penetration - 15) return 100
  return 100 + penetration / (0.9 * resistance - penetration)
}

/** Damage and penetration kept after going through (the «CF» of the game). */
export function keptAfterPenetration(resistance: number, penetration: number) {
  return clamp(penetration / (resistance + 12), 0.6, 1)
}

/** Chance (0–1) that a piece in its current state stops nothing for this penetration. */
export function pieceChance(piece: Pick<ArmorPiece, 'armorClass' | 'durability' | 'maxDurability'>, penetration: number) {
  if (piece.durability <= 0) return 1
  return clamp(penetrationChancePercent(realResistance(piece.armorClass, piece.durability, piece.maxDurability), penetration), 0, 100) / 100
}

/** Ricochet chance (0–1) at an angle between the shot and the surface normal (degrees). */
export function ricochetChance(piece: Pick<ArmorPiece, 'ricochet'>, angle: number) {
  const values = piece.ricochet
  if (!values || values.x <= 0 || angle <= values.z) return 0
  const t = clamp((angle - 90) / (values.z - 90), 0, 1)
  return values.x + (values.y - values.x) * t
}

export type LayerOutcome = 'through' | 'stopped' | 'ricochet' | 'broken' | 'behind'

export interface LayerResult {
  key: string
  name: string
  armorClass: number
  outcome: LayerOutcome
  /** Chance in percent the bullet had of going through (before the roll). */
  chance: number
  /** Penetration the piece met, and the damage the bullet carried to it. */
  penetrationIn: number
  damageIn: number
  durabilityBefore: number
  durabilityAfter: number
  maxDurability: number
}

export interface StageResult {
  layers: LayerResult[]
  /** Damage that reaches the body from this stage (0 for a plate gone through: the bullet goes on). */
  bodyDamage: number
  /** Whether the bullet goes on to the next stage (a plate gone through). */
  continues: boolean
  damageOut: number
  penetrationOut: number
  armorDamageOut: number
}

/**
 * One collider hit through the pieces over it, in the game's order: rolls first (SetShotStatus), then the damage
 * (ProceedDamageThroughArmor). The pieces' durability is lowered in place. `plateStage`: the hit is on a plate collider.
 */
export function resolveStage(pieces: ArmorPiece[], damage: number, penetration: number, armorDamage: number, random: () => number, options: { plateStage?: boolean; angle?: number } = {}): StageResult {
  const ordered = orderPieces(pieces)
  let stoppedBy: string | undefined
  let deflectedBy: string | undefined
  const chances = new Map<string, number>()
  for (const piece of ordered) {
    if (piece.durability > 0 && options.angle !== undefined && random() < ricochetChance(piece, options.angle)) { deflectedBy = piece.key; break }
    const chance = pieceChance(piece, penetration) * 100
    chances.set(piece.key, chance)
    if (stoppedBy || piece.durability <= 0) continue
    if (chance - random() * 100 < 0) stoppedBy = piece.key
  }
  let dmg = damage, pen = penetration, armor = armorDamage
  let ended = false
  const layers: LayerResult[] = []
  for (const piece of ordered) {
    const before = piece.durability
    const base: Omit<LayerResult, 'outcome' | 'durabilityAfter'> = { key: piece.key, name: piece.name, armorClass: piece.armorClass, chance: chances.get(piece.key) ?? 0, penetrationIn: pen, damageIn: dmg, durabilityBefore: before, maxDurability: piece.maxDurability }
    if (ended) {
      dmg *= piece.bluntThroughput
      layers.push({ ...base, outcome: 'behind', durabilityAfter: before })
      continue
    }
    if (piece.durability <= 0) {
      layers.push({ ...base, outcome: 'broken', durabilityAfter: 0 })
      if (deflectedBy === piece.key) ended = true
      continue
    }
    if (deflectedBy) { dmg /= 2; armor /= 2; pen /= 2 }
    const blunt = piece.bluntThroughput * (piece.softReduce ? BLUNT_SOFT_ARMOR_FACTOR : 1)
    const penBefore = pen
    const resistance = realResistance(piece.armorClass, piece.durability, piece.maxDurability)
    const acr = classResistance(piece.armorClass)
    const destructibility = piece.destructibility
    let loss: number
    let outcome: LayerOutcome
    if (piece.key !== stoppedBy && piece.key !== deflectedBy) {
      if (options.plateStage) dmg = 0
      const kept = keptAfterPenetration(resistance, penBefore)
      dmg *= kept
      pen *= kept
      loss = pen * armor * clamp(penBefore / acr, 0.5, 0.9) * destructibility
      outcome = 'through'
    } else {
      loss = pen * armor * clamp(penBefore / acr, 0.6, 1.1) * destructibility
      dmg *= blunt * clamp(1 - 0.03 * (resistance - penBefore), 0.2, 1)
      outcome = piece.key === deflectedBy ? 'ricochet' : 'stopped'
      ended = true
    }
    piece.durability = Math.max(0, piece.durability - Math.max(1, loss))
    layers.push({ ...base, outcome, durabilityAfter: piece.durability })
  }
  // A plate gone through deals the body nothing itself; the bullet carries on with its damage and penetration × CF.
  if (options.plateStage && !ended) {
    const keep = layers.reduce((value, layer) => layer.outcome === 'through' ? value * keptAfterPenetration(realResistance(layer.armorClass, layer.durabilityBefore, layer.maxDurability), layer.penetrationIn) : value, 1)
    return { layers, bodyDamage: 0, continues: true, damageOut: damage * keep, penetrationOut: penetration * keep, armorDamageOut: armorDamage }
  }
  return { layers, bodyDamage: dmg, continues: false, damageOut: dmg, penetrationOut: pen, armorDamageOut: armor }
}

/** Removable pieces first, built-in ones last (the game's OrderLockedLast); the kit's own order otherwise. */
export function orderPieces(pieces: ArmorPiece[]) {
  return [...pieces.filter((piece) => piece.removable), ...pieces.filter((piece) => !piece.removable)]
}

export interface HitSpot {
  collider: Collider
  /** A plate collider in front of the body collider at this spot, when a plate there covers it. */
  plate?: PlateZone
  /** Degrees between the shot and the surface normal (a rounded head); undefined for a flat front. */
  angle?: number
}

export interface ShotOutcome {
  spot: HitSpot
  part: BodyPart
  penetration: number
  stages: StageResult[]
  /** Damage to the hit part before it spreads. */
  damage: number
  /** Whether the bullet reached the body through everything. */
  penetrated: boolean
  /** The damage the parts took, by part (spread over-damage included). */
  applied: Partial<Record<BodyPart, number>>
  killed: boolean
  /** The parts destroyed by this shot. */
  destroyed: BodyPart[]
}

/** Pieces of the kit that cover a plate zone or a collider. */
export function piecesOver(kit: ArmorPiece[], spot: { plate?: PlateZone; collider?: Collider }) {
  if (spot.plate) return kit.filter((piece) => piece.plates.includes(spot.plate!))
  if (spot.collider) return kit.filter((piece) => piece.colliders.includes(spot.collider!))
  return []
}

/** A bullet at a spot of a character in a kit: the plate first when there is one, then the body collider. */
export function fireAt(kit: ArmorPiece[], body: BodyState, spot: HitSpot, round: Round, random: () => number): ShotOutcome {
  let part = COLLIDER_PART[spot.collider]
  const penetration = Math.max(0, round.penetrationDeviation ? normal(random, round.penetration, round.penetrationDeviation) : round.penetration)
  const stages: StageResult[] = []
  let damage = round.damage, pen = penetration, armor = round.armorDamage
  let bodyDamage = 0
  let penetrated = true
  const platePieces = spot.plate ? piecesOver(kit, { plate: spot.plate }) : []
  if (platePieces.length) {
    const stage = resolveStage(platePieces, damage, pen, armor, random, { plateStage: true, angle: spot.angle })
    stages.push(stage)
    if (!stage.continues) { bodyDamage = stage.bodyDamage; penetrated = false; part = platePart(spot.plate!) }
    damage = stage.damageOut; pen = stage.penetrationOut; armor = stage.armorDamageOut
  }
  if (penetrated) {
    const pieces = piecesOver(kit, { collider: spot.collider })
    if (pieces.length) {
      const stage = resolveStage(pieces, damage, pen, armor, random, { angle: spot.angle })
      stages.push(stage)
      bodyDamage = stage.bodyDamage
      penetrated = stage.layers.every((layer) => layer.outcome === 'through' || layer.outcome === 'broken')
    } else bodyDamage = damage
  }
  const result = applyDamage(body, part, bodyDamage)
  return { spot, part, penetration, stages, damage: bodyDamage, penetrated, applied: result.applied, killed: result.killed, destroyed: result.destroyed }
}

export interface BodyState {
  max: Health
  current: Health
  destroyed: Partial<Record<BodyPart, boolean>>
  dead: boolean
}

export function freshBody(max: Health, blackedOut: BodyPart[] = []): BodyState {
  const current = { ...max }
  const destroyed: BodyState['destroyed'] = {}
  for (const part of blackedOut) { current[part] = 0; destroyed[part] = true }
  return { max: { ...max }, current, destroyed, dead: false }
}

/** The game's ApplyDamage on the body (in place): the part, then what it could not take spread over the others. */
export function applyDamage(body: BodyState, part: BodyPart, damage: number): { applied: Partial<Record<BodyPart, number>>; killed: boolean; destroyed: BodyPart[] } {
  const applied: Partial<Record<BodyPart, number>> = {}
  const destroyed: BodyPart[] = []
  if (body.dead || damage <= 0) return { applied, killed: false, destroyed }
  const take = (target: BodyPart, amount: number) => {
    const before = body.current[target]
    body.current[target] = Math.max(0, before - amount)
    applied[target] = (applied[target] ?? 0) + (before - body.current[target])
    if (body.current[target] <= 0 && !body.destroyed[target]) { body.destroyed[target] = true; destroyed.push(target) }
    if (body.destroyed[target] && (target === 'Head' || target === 'Chest')) body.dead = true
    return before
  }
  const before = take(part, damage)
  const over = Math.max(0, damage - before)
  if (over > 0) {
    const others = BODY_PARTS.filter((other) => other !== part && !body.destroyed[other])
    const total = others.reduce((sum, other) => sum + body.max[other], 0)
    const spread = over * OVER_DAMAGE_FACTOR[part]
    if (total > 0) for (const other of others) take(other, spread * body.max[other] / total * OVER_DAMAGE_RECEIVED)
  }
  return { applied, killed: body.dead, destroyed }
}

export function totalHealth(health: Health) {
  return BODY_PARTS.reduce((sum, part) => sum + health[part], 0)
}

/** A copy of a kit to shoot at (the durability changes). */
export function cloneKit(kit: ArmorPiece[]) {
  return kit.map((piece) => ({ ...piece, colliders: [...piece.colliders], plates: [...piece.plates] }))
}

/** A seeded generator (mulberry32) for repeatable series. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A normally distributed value (Box–Muller). */
export function normal(random: () => number, mean: number, deviation: number) {
  const u = Math.max(1e-9, random())
  const v = random()
  return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
