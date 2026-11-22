/**
 * The build's picture made of the game's own part pictures (owner, 20.11.2026: «я выбрал магазин… у меня поставился магазин. Я выбрал
 * прицел… поставился прицел»; «делай уже по новой системе сборки… по картинке модуля, с заменой модулей прямо в прямом эфире»). Every
 * weapon and module was drawn once by the game itself, alone, from the side (an offline copy of the game, the RaidOsGuns plugin): its
 * picture, the depth of every pixel and the points of its slots. Only these pictures and numbers are used; no model leaves the game.
 *
 * A build is laid like the game puts it together: each part at its parent's slot point. A slot's bone turned as most are holds the part
 * upright; another turn about the barrel's axis turns the picture (a grip hung under a rail is upside down). A part turned towards the
 * eye (on a side rail) is laid in the picture's plane at its own place along the view (`flatten`): over the weapon on the near side,
 * behind it on the far side.
 */
import type { Build, BuildNode } from './gunTypes'

/** One part's picture: size, the pixel of its origin, the depth range (metres along the view) and its slots (position xyz, turn xyzw). */
export interface PartAsset {
  w: number; h: number; o: [number, number]; d: [number, number]; s: Record<string, number[]>
  /** The folded look (the game's own fold, E:\SPT-photo\weapons): a weapon with its stock folded, a stock folded with its weapon. */
  fold?: Omit<PartAsset, 'fold' | 'fs'>
  /** A weapon whose stock folds: the slot that folds (`mod_stock`, `mod_stock_akms`…). */
  fs?: string
  /** The game's own extra turn of the part on its slot (xyzw, in the part's frame), measured on the game's assembled presets. */
  fix?: number[]
  /**
   * A stock: the slope of its top edge (degrees, down to the back positive) as laid on the weapon, its slot's own tilt taken off
   * (E:\SPT-photo\weapons\stock_level.py): the stock is turned by it to stand level.
   */
  lv?: number
}
export interface PartsIndex { ppm: number; parts: Record<string, PartAsset> }

type Mat3 = [number, number, number, number, number, number, number, number, number]
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

function quat([x, y, z, w]: number[]): Mat3 {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}
const mul = (a: Mat3, b: Mat3): Mat3 => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!)) as Mat3
const transpose = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
const apply = (a: Mat3, v: [number, number, number]): [number, number, number] =>
  [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]]
/** The turn of most slot bones (-90° about X): it holds a part upright. */
const STANDARD_BACK = transpose(quat([-0.70711, 0, 0, 0.70711]))

/** A stock's slot (`mod_stock`, `mod_stock_000`, `mod_stock_akms`…). */
const isStockSlot = (path: string) => (path.split('/').pop() ?? '').startsWith('mod_stock')
/** A part on a stock shorter than this (metres along the weapon) is a pad or lock, not a stock: it follows what it is on. */
const ADAPTER_LENGTH = 0.06
/** A stock tube or tube adapter: 15–30 cm long and no taller than 8 cm (the AK-12, RPK-16, AKTS, M4, AGR-870, VAL NB tubes). */
const isTube = (asset: { w: number; h: number }, ppm: number) => asset.w / ppm >= 0.15 && asset.w / ppm <= 0.3 && asset.h / ppm <= 0.08
/** The largest tilt of a slot taken off a stock (the AK family's 3.6°, VAL 6°, APB 10°): more is a real turn (a fold). */
const MAX_TILT = Math.PI / 12
/** The largest top-edge slope levelled (UZI 25°): more is the stock's shape, not its lie. */
const MAX_LEVEL = (35 * Math.PI) / 180
/** `turn` turned about the view by `angle`: the part's picture turns by −angle in the picture's plane (pixels, y down). */
function aboutView(turn: Mat3, angle: number): Mat3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)]
  return mul([1, 0, 0, 0, c, -s, 0, s, c], turn)
}

/**
 * The turn about the view that lays a stock level (owner, 20.11.2026: «некоторые приклады встают под углом… Они должны стоять ровно…
 * АК… смотрит чуть-чуть наверх… у Скара, МК-17… смотрит вниз… У УЗИ приклад разложен вниз… горизонтально должен стоять»): the small
 * tilt of where it lies is taken off (the game's AK-74M stock slot is turned 3.59°, and the game draws it so) and, unfolded, its top
 * edge levelled (`lv`).
 */
function levelAngle(turn: Mat3, level: number | undefined): number {
  const angle = Math.atan2(turn[5], turn[8])
  const tilt = angle - (Math.PI / 2) * Math.round(angle / (Math.PI / 2))
  const slope = level === undefined ? 0 : (level * Math.PI) / 180
  return (Math.abs(tilt) > 1e-6 && Math.abs(tilt) <= MAX_TILT ? tilt : 0) + (slope && Math.abs(slope) <= MAX_LEVEL ? slope : 0)
}

/** The nearest turn about the view alone: the part's own length (its Z) kept where it points in the picture's plane, its side up. */
function flatten(turn: Mat3): Mat3 {
  const [zy, zz] = [turn[5], turn[8]]
  const length = Math.hypot(zy, zz)
  if (length < 1e-6) return IDENTITY
  const [c, s] = [zz / length, -zy / length]
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

/** A part where it stands in the picture: its picture's pixels go through `m` (2×3, to the build's pixels); `x` its place along the view. */
export interface PlacedPart {
  tpl: string
  asset: PartAsset
  /** Picture pixel (u, v) → build pixel: [a, b, c, d, e, f] as u' = a·u + b·v + c, v' = d·u + e·v + f. */
  m: [number, number, number, number, number, number]
  /** The part's origin along the view (metres), to which its depth range adds. */
  x: number
  /** Drawn folded: its pictures are `<id>.fold.webp` / `<id>.fold.d.png`. */
  fold?: boolean
}

/**
 * `anchors`: where each slot of a drawn part is on the picture (pixels), by the slot's path in the build (slot ids joined by «/»): the
 * point an empty slot's cell points at. `centers`: the middle of each drawn part's picture by its path, for the cell of a filled slot.
 */
export interface LaidBuild {
  parts: PlacedPart[]
  missing: string[]
  width: number
  height: number
  near: number
  far: number
  anchors: Record<string, [number, number]>
  centers: Record<string, [number, number]>
  /** Each drawn part's box on the picture (left, top, right, bottom) by its path. */
  boxes: Record<string, [number, number, number, number]>
  /** The weapon's stock folds (owner, 20.11.2026: «кнопки сложить, разложить… приклад»). */
  foldable: boolean
}

/** How far in front of the receiver a folded stock brought to the near side lies (metres along the view). */
const FOLDED_GAP = 0.002

/**
 * A stock folded to the far side of the receiver (the AK family folds to its left, the picture shows the right) lay behind it, hidden
 * in the receiver (owner, 20.11.2026: «при нажатии уходит в текстуры, а он должен находиться снаружи»): the folded stock and what
 * is on it are brought just in front of the receiver, so it shows outside, lying along it. A stock folding to the near side stays.
 */
function bringFoldedStockNear(placed: PlacedPart[], paths: string[], foldSlot: string) {
  const receiver = placed[paths.indexOf('')]
  const group = placed.filter((_, index) => paths[index] === foldSlot || paths[index]!.startsWith(`${foldSlot}/`))
  // folded is the weapon's folded look (its stock slot turned) or the stock's own folded picture; nothing else moves
  if (!receiver || !group.length || !(receiver.fold || group.some((part) => part.fold))) return
  const middle = (part: PlacedPart) => part.x + (part.asset.d[0] + part.asset.d[1]) / 2
  const groupNear = Math.min(...group.map((part) => part.x + part.asset.d[0]))
  const groupFar = Math.max(...group.map((part) => part.x + part.asset.d[1]))
  if ((groupNear + groupFar) / 2 <= middle(receiver)) return
  const shift = receiver.x + receiver.asset.d[0] - FOLDED_GAP - groupFar
  for (const part of group) part.x += shift
}

/**
 * The build laid out: every part covered by the index at its place, the picture's size (pixels at the index's scale) and the depth range.
 * `missing`: parts with no picture yet.
 */
export function layBuild(build: Build, index: PartsIndex, options: { folded?: boolean } = {}): LaidBuild {
  const weapon = index.parts[build.weaponId]
  const foldSlot = weapon?.fs
  const folded = Boolean(options.folded && foldSlot)
  const ppm = index.ppm
  const placed: PlacedPart[] = []
  const missing: string[] = []
  const anchors: Record<string, [number, number]> = {}
  const centers: Record<string, [number, number]> = {}
  const partPaths: string[] = []
  const partTurn = (tpl: string, given: Mat3): Mat3 => {
    const plain = index.parts[tpl]
    // The game's own turn of the part where it puts it straight on its slot's bone (measured on its assembled presets, `fix`): the
    // MP-18, PKM and RPD barrels drawn hanging, the SPEAR receiver, the T-5000M chassis, the M3 forend… (owner, 20.11.2026: «ствол
    // должен быть цельным… у всех оружие должно смотреть прямо»).
    const fixed = plain?.fix ? mul(given, quat(plain.fix)) : given
    // A part turned towards the eye (on a side rail; owner, 20.11.2026: «предметы, которые ставятся на боковое крепление, должны
    // показываться… с правой стороны… на боковом креплении с той стороны»): laid in the picture's plane, its length along the weapon as
    // it is, at its own place along the view — on the near side it is drawn over the weapon, on the far side behind it.
    return Math.abs(Math.abs(fixed[0]) - 1) > 1e-3 ? flatten(fixed) : fixed
  }
  const walk = (tpl: string, node: BuildNode | undefined, at: [number, number, number], given: Mat3, path: string, hang = false, onCarrier = false) => {
    const plain = index.parts[tpl]
    // a grip on a side rail pointing at the eye (the 6P29M's only foregrip slot) hangs down under its rail, as it is read from the side
    const laidTurn = hang ? aboutView(partTurn(tpl, given), Math.PI) : partTurn(tpl, given)
    // folded: the weapon in its folded look, and the stock in the folding slot in its own when it has one
    const foldsHere = folded && (path === '' || path === foldSlot) && Boolean(plain?.fold)
    const asset = foldsHere ? plain!.fold! : plain
    if (!asset) { missing.push(tpl); return }
    // A stock stands level, and so does a stock tube (owner, 22.11.2026: «приклады до сих пор кривые на ак 12 и всех других автоматах,
    // приклады и труба приклада»; «проверь все трубы прикладов, что бы именно они были ровные»). Levelled, each about its own slot
    // point: the part in the weapon's stock slot, every tube, and a stock on a tube or on a short lock. The game lays the AK-12 tube on
    // the receiver's 3.59° slot and the stock 4.2° back up on the tube, so a stock that only followed its levelled tube stood 4.2° off
    // it; the AGR-870 tube hung 5° from its grip. The PT-1 and PT-3 stand level on the 2.4 cm PT lock (21.11.2026: «он стоит криво»).
    // Anything else on a stock follows it as the game puts it together: the SCAR body and cheek on the hinge, the UAS butt on the SKS
    // chassis, the ST-EF 74 pad flush on the AKS-74U frame's 3.5° end («подушка… стоит криво, там щель»). The top edge (`lv`) is
    // levelled only unfolded.
    const chainRoot = isStockSlot(path) && !path.split('/').slice(0, -1).some((segment) => segment.startsWith('mod_stock'))
    const long = asset.w / ppm >= ADAPTER_LENGTH
    const levelled = isStockSlot(path) && (chainRoot || (long && (isTube(asset, ppm) || onCarrier)))
    // what is on a tube or a short lock is levelled in its turn
    const carrier = isStockSlot(path) && (!long || isTube(asset, ppm))
    const inFold = folded && Boolean(foldSlot) && (path === foldSlot || path.startsWith(`${foldSlot}/`))
    const turn = levelled ? aboutView(laidTurn, levelAngle(laidTurn, !inFold ? plain?.lv : undefined)) : laidTurn
    // the X axis (the view) kept or turned round: the picture turns in its plane; any other turn faces the part towards the eye
    // a local (y, z) goes to turn·(y, z); in pixels right is -z, down is -y
    const [a, b, d, e] = [turn[8], turn[7], turn[5], turn[4]]
    const cx = -at[2] * ppm
    const cy = -at[1] * ppm
    const [ux, uy] = asset.o
    placed.push({ tpl, asset, x: at[0], m: [a, b, cx - a * ux - b * uy, d, e, cy - d * ux - e * uy], ...(foldsHere ? { fold: true } : {}) })
    partPaths.push(path)
    for (const [slotId, slot] of Object.entries(asset.s)) {
      const offset = apply(turn, [slot[0]!, slot[1]!, slot[2]!])
      anchors[path ? `${path}/${slotId}` : slotId] = [-(at[2] + offset[2]) * ppm, -(at[1] + offset[1]) * ppm]
    }
    for (const [slotId, child] of Object.entries(node?.children ?? {})) {
      const slot = asset.s[slotId]
      if (!slot) { missing.push(child.itemId); continue }
      const offset = apply(turn, [slot[0]!, slot[1]!, slot[2]!])
      const childTurn = mul(mul(turn, quat(slot.slice(3))), STANDARD_BACK)
      // A foregrip whose slot faces the eye (the 6P29M: its grip slot is on the side, turned a quarter about the barrel; owner,
      // 21.11.2026: «рукоятки встают неправильно на этом цевье… Так происходит со всеми рукоятками на этом цевье») stood straight up
      // from the barrel's axis: it is drawn hanging from below the mount instead, its side offset taken as the depth below the axis.
      const sideGrip = slotId.startsWith('mod_foregrip') && Math.abs(Math.abs(childTurn[0]) - 1) > 1e-3
      const place: [number, number, number] = sideGrip ? [0, offset[1] - Math.abs(offset[0]), offset[2]] : offset
      walk(child.itemId, child, [at[0] + place[0], at[1] + place[1], at[2] + place[2]], childTurn, path ? `${path}/${slotId}` : slotId, sideGrip, carrier)
    }
  }
  walk(build.weaponId, build.root, [0, 0, 0], IDENTITY, '')
  if (folded && foldSlot) bringFoldedStockNear(placed, partPaths, foldSlot)
  // the fold button only where folding shows: the weapon has a folded look, or the stock in the folding slot has its own
  const foldStock = foldSlot ? build.root.children[foldSlot]?.itemId : undefined
  const foldable = Boolean(foldSlot && (weapon?.fold || (foldStock && index.parts[foldStock]?.fold)))
  // the picture's box: every part's corners through its placing
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  let [near, far] = [Infinity, -Infinity]
  for (const part of placed) {
    for (const [u, v] of [[0, 0], [part.asset.w, 0], [0, part.asset.h], [part.asset.w, part.asset.h]] as const) {
      const px = part.m[0] * u + part.m[1] * v + part.m[2]
      const py = part.m[3] * u + part.m[4] * v + part.m[5]
      left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py)
    }
    near = Math.min(near, part.x + part.asset.d[0])
    far = Math.max(far, part.x + part.asset.d[1])
  }
  if (!placed.length) return { parts: [], missing, width: 0, height: 0, near: 0, far: 1, anchors: {}, centers: {}, boxes: {}, foldable }
  // the box's corner to (0, 0)
  for (const part of placed) { part.m[2] -= left; part.m[5] -= top }
  for (const point of Object.values(anchors)) { point[0] -= left; point[1] -= top }
  const boxes: Record<string, [number, number, number, number]> = {}
  placed.forEach((part, index) => {
    const [w, h] = [part.asset.w / 2, part.asset.h / 2]
    centers[partPaths[index]!] = [part.m[0] * w + part.m[1] * h + part.m[2], part.m[3] * w + part.m[4] * h + part.m[5]]
    const xs = [0, part.asset.w].flatMap((u) => [0, part.asset.h].map((v) => part.m[0] * u + part.m[1] * v + part.m[2]))
    const ys = [0, part.asset.w].flatMap((u) => [0, part.asset.h].map((v) => part.m[3] * u + part.m[4] * v + part.m[5]))
    boxes[partPaths[index]!] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  })
  return { parts: placed, missing, width: Math.ceil(right - left), height: Math.ceil(bottom - top), near, far, anchors, centers, boxes, foldable }
}
