/**
 * The game's recoil (owner, 22.11.2026: «при автоматической стрельбе отдачу, как в игре. То есть в зависимости от патрона, от
 * оружия, от сборки оружия… чтобы каждая мелочь влияла, и чтобы можно было протестировать отдачу»), as Escape from Tarkov's "new
 * recoil" (0.16.9, RecoilPipeline 1) does it, read from its code (Assembly-CSharp: NewRecoilShotEffect, NewRotationRecoilProcess,
 * RecoilProcessBase, ProceduralWeaponAnimation) and the player prefab's values:
 *
 * - every 1/60 s tick the hand's turn C (x: the barrel down, z: to the right) moves by its velocity V, damped and pulled back;
 * - a shot adds a kick of the weapon's force (RecoilForceUp scaled by the mods' recoil, + 20) × the round's (1 + its recoil),
 *   at an angle of RecoilAngle ± RecolDispersion; from the RecoilStableIndexShot-th shot on the climb stops and the angle widens
 *   by RecoilStableAngleIncreaseStep a shot (up to ProgressRecoilAngleOnStable) — the plateau with a growing side spread;
 * - the camera kicks too (RecoilCamera) and, aiming, follows the barrel's pitch; once the shooting is over it also turns to where
 *   the barrel settled sideways, so the reticle stands in the middle of the scope again, the aim moved instead (owner, 24.11.2026:
 *   «некоторые сетки при увеличении начинают уезжать в сторону… сетка должна стоять по центру, а она начинает стоять ближе к
 *   правой стороне»: the barrel's side offset left on the screen grew with the magnification).
 * Angles in degrees. The bullets go where the barrel points; the screen shows the camera's view.
 */
import data from './rangeRecoil.json'
import type { Weapon } from '../arsenal/gunTypes'

export interface WeaponRecoil {
  up: number
  angle: number
  dispersion: number
  camera: number
  stableShot: number
  stableStep: number
  stableAngle: [number, number]
  damping: number
  returnSpeed: number
  category: number
  returnOffset: number
  returnDamping: number
  postVertical: [number, number]
  postHorizontal: [number, number]
  resetAfterShot: boolean
  groups: Array<{ start: number; end: number; rotation: [number, number]; angle: [number, number] }>
  cameraSpeed: [number, number]
  cameraStep: number
  fireRate: number
}

const WEAPONS = (data as unknown as { weapons: Record<string, WeaponRecoil> }).weapons

/** The game's recoil of a weapon (its template), undefined for one the data lacks. */
export function weaponRecoil(id: string): WeaponRecoil | undefined {
  return WEAPONS[id]
}

/**
 * A weapon's recoil for the range: its own, else that of the most alike weapon the data has — the same class and calibre first,
 * then the class, then the calibre — nearest in vertical recoil, at this weapon's own force and fire rate. 14 of 170 weapons had
 * none in 11.2026 (MXLR, АК-308, M16A1/A2, HK 416A5, QBZ-191, Type 20…) and kicked not at all (owner, 23.11.2026: «до сих пор
 * пропадает отдача… при разных вариациях переключения прицела и оружия»).
 */
export function similarRecoil(weapon: Pick<Weapon, 'id' | 'weaponClass' | 'caliber' | 'recoilVertical' | 'fireRate'>, weapons: readonly Pick<Weapon, 'id' | 'weaponClass' | 'caliber' | 'recoilVertical'>[]): WeaponRecoil | undefined {
  const own = WEAPONS[weapon.id]
  if (own) return own
  const known = weapons.filter((other) => other.id !== weapon.id && WEAPONS[other.id])
  const pool = [
    known.filter((other) => other.weaponClass === weapon.weaponClass && other.caliber === weapon.caliber),
    known.filter((other) => other.weaponClass === weapon.weaponClass),
    known.filter((other) => other.caliber === weapon.caliber),
    known,
  ].find((tier) => tier.length)
  if (!pool) return undefined
  const nearest = [...pool].sort((a, b) => Math.abs(a.recoilVertical - weapon.recoilVertical) - Math.abs(b.recoilVertical - weapon.recoilVertical))[0]!
  const like = WEAPONS[nearest.id]!
  return { ...like, up: weapon.recoilVertical || like.up, fireRate: weapon.fireRate || like.fireRate }
}

const DT = 1 / 60
const DEG = Math.PI / 180
/** globals.json Aiming: aiming's hand intensity, the vertical bonus, the convergence multiplier. */
const AIM_INTENSITY = 0.75
const VERTICAL_BONUS = 20
const CONVERGENCE = 1
/** The player prefab: incoming strength, its random range, the progress from the 2nd shot, the shot's share to the hand, the return curve,
 * the stable mode's limit, its random reach and pull, the camera's return and damping. */
const INCOMING = 0.1399
/**
 * The range's own recoil, a little under the game's (owner, 24.11.2026: «Сделай ее, чтобы она чуть-чуть отличалась от оригинальной.
 * Чуть-чуть меньше отдачу сделай»): every kick, the barrel's and the camera's that follows it, 8 % softer.
 */
export const RANGE_RECOIL_SCALE = 0.92
const STRENGTH: [number, number] = [0.9, 1.15]
const PROGRESS_SHOT = 2
const HAND_SHARE = 0.15
const RETURN_CURVE = 0.008
const STABLE_LIMIT = 0.95
const STABLE_REACH: [number, number] = [0.1, 8]
const STABLE_PULL = 0.2
const CAMERA_RETURN = 0.05
const CAMERA_DAMPING = 0.5

interface Vec { x: number; y: number; z: number }
const vec = (): Vec => ({ x: 0, y: 0, z: 0 })
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const length = (a: Vec) => Math.hypot(a.x, a.y, a.z)
/** Unity's Mathf.Clamp (the low bound first). */
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export interface RecoilReading {
  /** Where the barrel points against the mouse's aim, degrees up and to the right. */
  bore: { up: number; right: number }
  /** Where the view (the screen, the scope) points against it. */
  view: { up: number; right: number }
}

export interface RecoilSim {
  /** A shot fired. */
  shot(): void
  /** One 1/60 s tick; `held`: the trigger held in automatic fire. */
  tick(held: boolean): void
  read(): RecoilReading
  /** All at rest (nothing left to return). */
  resting(): boolean
}

/**
 * A weapon's recoil, aiming, standing. `modsRecoil`: Σ of the mods' recoil (fraction, −0.29 = −29 %), `roundRecoil`: the round's
 * recoil (fraction), `baseUp`: the weapon's vertical recoil (the live catalogue's, else the template's).
 */
export function createRecoil(weapon: WeaponRecoil, modsRecoil: number, roundRecoil: number, random: () => number = Math.random, baseUp = weapon.up): RecoilSim {
  const rand = (lo: number, hi: number) => lo + (hi - lo) * random()
  const N = Math.max(1, weapon.stableShot)
  const f0 = Math.max(0, 1 + modsRecoil)
  const base = (baseUp * f0 + VERTICAL_BONUS) * INCOMING * RANGE_RECOIL_SCALE
  const strength = 1 + roundRecoil
  const returnSpeed = weapon.returnSpeed * CONVERGENCE
  const s = {
    index: 0, auto: false, stable: false, widen: 0, progress: 1,
    C: vec(), V: vec(), A: vec(), kicked: false, stableC: vec(), next: vec(), speed: 0,
    previousX: 0, returning: false, side: 2, impulse: 0.01, after: { v: 0, h: 0 }, afterX: 0,
    camC: vec(), camV: vec(), camA: vec(), camKicked: false,
    follow: 0, followTarget: 0, followSpeed: weapon.cameraSpeed[0], followRight: 0,
    /** How far the barrel, the view and the camera moved in the last tick (degrees). */
    moved: 0,
  }

  const groupsAt = (index: number) => weapon.groups.filter((group) => group.start <= index && index <= group.end)
    .reduce((sum, group) => ({ rotation: [sum.rotation[0] + group.rotation[0], sum.rotation[1] + group.rotation[1]], angle: [sum.angle[0] + group.angle[0], sum.angle[1] + group.angle[1]] }), { rotation: [0, 0], angle: [0, 0] })

  return {
    shot() {
      s.index += 1
      if (s.index === N && !s.stable) { s.stable = true; s.stableC = { ...s.C } }
      s.progress = s.index >= PROGRESS_SHOT ? clamp(s.index, 1, N) / N : 1
      const groups = groupsAt(s.index)
      const rotation = rand(STRENGTH[0] * base + groups.rotation[0], STRENGTH[1] * base + groups.rotation[1]) * strength
      let lo = groups.angle[0], hi = groups.angle[1]
      if (s.stable) {
        s.widen = clamp(s.widen + weapon.stableStep, weapon.stableAngle[0], weapon.stableAngle[1])
        lo -= s.widen
        hi += s.widen
      }
      const angle = rand(weapon.angle - weapon.dispersion + lo, weapon.angle + weapon.dispersion + hi) * DEG
      const dx = -Math.sin(angle) * rotation
      const dy = Math.cos(angle) * rotation
      if (s.stable) s.V = vec()
      s.A.x += dx * HAND_SHARE * weapon.category * s.progress
      s.A.z += dy * HAND_SHARE * weapon.category * s.progress
      s.kicked = true
      s.returning = true
      s.camA.x += dx * weapon.camera
      s.camA.y += -dy * weapon.camera
      s.camKicked = true
    },
    tick(held) {
      const before = { C: { ...s.C }, camC: { ...s.camC }, follow: s.follow, followRight: s.followRight }
      if (held) s.auto = true
      else { s.auto = false; s.index = 0; if (s.stable) { s.stable = false; s.widen = 0 } }
      // the camera's own kick
      if (s.camKicked) { s.camV = add(s.camV, s.camA); s.camA = vec(); s.camKicked = false }
      s.camV = scale(sub(s.camV, scale(s.camC, CAMERA_RETURN)), CAMERA_DAMPING)
      s.camC = add(s.camC, s.camV)
      // the hands
      if (s.kicked) {
        s.V = add(s.V, scale(s.A, AIM_INTENSITY))
        s.A = vec()
        if (s.stable) {
          let next = add(s.stableC, scale(s.V, rand(STABLE_REACH[0], STABLE_REACH[1])))
          if (length(sub(next, s.C)) > STABLE_LIMIT) next = add(s.C, scale(sub(next, s.C), STABLE_LIMIT))
          s.next = next
        }
      }
      if (!s.auto) s.speed = returnSpeed * RETURN_CURVE
      if (s.kicked && s.auto && !s.stable) s.speed *= s.progress
      s.V = scale(s.V, weapon.damping)
      if (!s.stable) { s.V = sub(s.V, scale(s.C, s.speed)); s.C = add(s.C, s.V) } else s.C = add(s.C, scale(sub(s.next, s.C), STABLE_PULL))
      // the way back after a single shot or a released trigger
      const side = s.side === 1 ? 1 : -1
      if (s.C.x < s.previousX && s.returning) {
        s.after = { v: rand(weapon.postVertical[0], weapon.postVertical[1]), h: s.side === 1 ? rand(s.C.z, weapon.postHorizontal[1]) : s.side === 0 ? rand(weapon.postHorizontal[0], s.C.z) : 0 }
        s.afterX = s.C.x
        s.impulse = Math.abs(s.C.x * returnSpeed) * weapon.returnOffset
        s.side = s.C.z > 0 ? 1 : s.C.z < 0 ? 0 : rand(-1, 1) >= 0 ? 1 : 0
      } else if (!s.auto && s.returning) {
        s.impulse *= weapon.returnDamping
        if (s.impulse < 0.001) {
          if (weapon.resetAfterShot) { s.C = vec(); s.V = vec() }
          s.returning = false
        } else s.V.z += s.impulse * side
      }
      if (!s.auto && s.afterX !== 0) {
        const k = Math.abs(clamp(s.C.x, s.afterX, -0.01) / s.afterX)
        const t = clamp(1 - k, 0.01, 1) * 0.01
        s.C.x = lerp(s.C.x, s.after.v, t)
        s.C.z = lerp(s.C.z, s.after.h, t)
      }
      s.previousX = s.C.x
      s.kicked = false
      // aiming, the camera follows the barrel's pitch
      const step = weapon.cameraStep * DT
      if (s.auto && (s.C.x || s.C.z)) {
        s.followSpeed = clamp(s.followSpeed + step, weapon.cameraSpeed[0], weapon.cameraSpeed[1])
        if (!s.stable) s.followTarget = s.C.x
      } else {
        s.followSpeed = clamp(s.followSpeed - step, weapon.cameraSpeed[0], weapon.cameraSpeed[1])
        s.followTarget = s.C.x
      }
      s.follow = lerp(s.follow, s.followTarget, s.followSpeed)
      // the shooting over: the view turns to the barrel's side offset too
      if (!s.auto && !s.returning) s.followRight = lerp(s.followRight, s.C.z, s.followSpeed)
      s.moved = length(sub(s.C, before.C)) + length(sub(s.camC, before.camC)) + Math.abs(s.follow - before.follow) + Math.abs(s.followRight - before.followRight)
    },
    read() {
      return {
        bore: { up: -s.C.x, right: s.C.z },
        view: { up: -(s.follow + s.camC.x), right: s.followRight + s.camC.y },
      }
    },
    /**
     * At rest: no kick waiting for its tick (a single shot's kick is only taken up by the next tick: read as at rest before it, the
     * range stopped its ticks and a single shot never kicked — owner, 23.11.2026: «нету отдачи в одиночном режиме стрельбы»), and
     * nothing moving any more. The barrel settles where the game's after-shot offset leaves it, not always at the aim: its speed
     * then only holds that offset, so the rest is the barrel's, the view's and the camera's standing still, not the speed's zero.
     */
    resting() {
      return !s.auto && !s.kicked && !s.camKicked && !s.returning && s.moved < 1e-5 && length(s.camC) < 1e-3
    },
  }
}

export const RECOIL_TICK = DT

/** Degrees at a distance → centimetres. */
export const degreesToCm = (degrees: number, distance: number) => Math.tan(degrees * DEG) * distance * 100
