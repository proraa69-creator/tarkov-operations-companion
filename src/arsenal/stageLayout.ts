import type { SlotKind, Zone } from './boardLayout'

/**
 * The weapon drawn large with its module cells around it, each next to where its module sits (owner, 20.11.2026: «оружие сделать
 * больше, а сами квадратики… поменьше… вокруг оружия, примерно в тех местах, где находится модуль»), like the game's modding screen:
 * sights, mounts and the charging handle above the weapon, the magazine, grips and the rest below, the muzzle devices to its left and
 * the stock to its right when there is room at the sides; a thin line from every cell to its point on the weapon.
 */

export type Band = 'top' | 'bottom' | 'left' | 'right'

export interface StageCellInput {
  key: string
  kind: SlotKind | 'ammo'
  zone: Zone
  /** Steps from the weapon (1 for the weapon's own slots): at a side, the deeper ones go below first when the side is full. */
  depth: number
  /** The cell's point on the picture (picture pixels), when known. */
  anchor?: [number, number]
}

export interface StageCell {
  key: string
  band: Band
  /** The cell's top-left corner on the stage (CSS pixels). */
  x: number
  y: number
  /** The point on the weapon the cell's line goes to, and where the line leaves the cell (CSS pixels). */
  point: [number, number]
  from: [number, number]
}

export interface Stage {
  width: number
  height: number
  /** The picture's place and scale on the stage. */
  picture: { x: number; y: number; scale: number }
  cell: number
  cells: StageCell[]
}

export interface StageOptions {
  width: number
  cell: number
  gap: number
  /** Room between the cells and the picture, for the lines. */
  reach: number
  /** Sides used for the muzzle and the stock (a wide stage); a narrow one puts them below. */
  sides: boolean
  /** The picture is not drawn larger than this (its pictures are 1000 pixels a metre). */
  maxScale: number
}

/** Where a cell goes: above, below or at a side of the weapon. */
export function bandOf(cell: Pick<StageCellInput, 'kind' | 'zone'>, sides: boolean): Band {
  if (cell.kind === 'muzzle') return sides ? 'left' : 'bottom'
  if (cell.kind === 'stock') return sides ? 'right' : 'bottom'
  if (cell.zone === 'top' || cell.kind === 'receiver' || cell.kind === 'charge') return 'top'
  return 'bottom'
}

/**
 * Cells along a line, each as near its wanted middle (`wanted`) as the others let it: overlapping neighbours join a group centred on their
 * wanted middles, kept inside [lo, hi]. Returns each cell's start, in the input order.
 */
export function spread(wanted: number[], size: number, gap: number, lo: number, hi: number): number[] {
  const order = wanted.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index)
  type Group = { members: number[]; sum: number; start: number }
  const width = (group: Group) => group.members.length * size + (group.members.length - 1) * gap
  const place = (group: Group) => { group.start = Math.max(lo, Math.min(hi - width(group), group.sum / group.members.length - width(group) / 2)) }
  let groups: Group[] = order.map((entry) => ({ members: [entry.index], sum: entry.value, start: 0 }))
  groups.forEach(place)
  for (let merged = true; merged;) {
    merged = false
    const next: Group[] = []
    for (const group of groups) {
      const last = next[next.length - 1]
      if (last && last.start + width(last) + gap > group.start + 0.01) {
        last.members.push(...group.members)
        last.sum += group.sum
        place(last)
        merged = true
      } else next.push(group)
    }
    groups = next
  }
  const starts = new Array<number>(wanted.length)
  for (const group of groups) group.members.forEach((index, at) => { starts[index] = group.start + at * (size + gap) })
  return starts
}

/**
 * Cells into rows of at most `room`, every other one by their places along the weapon (left to right): each row spans the weapon,
 * and the lines of a row never cross each other.
 */
function rows<T extends { along: number }>(cells: T[], room: number): T[][] {
  if (cells.length <= room) return [cells]
  const sorted = [...cells].sort((a, b) => a.along - b.along)
  const count = Math.ceil(sorted.length / room)
  const out: T[][] = Array.from({ length: count }, () => [])
  sorted.forEach((entry, index) => out[index % count]!.push(entry))
  return out
}

/** The picture to lay around: its size and the boxes its parts cover (picture pixels: left, top, right, bottom). */
export interface StagePicture { width: number; height: number; boxes?: Array<[number, number, number, number]> }

/**
 * The cells around the weapon. A cell above or below goes as near its own part as it can (owner, 20.11.2026: «не на одном уровне,
 * а какой-то выше, какой-то ниже, ближе к своим реальным деталям»): under the barrel higher than under the magazine — but never over
 * a part of the weapon (a grip on the handguard stays free) nor over another cell.
 */
export function layStage(picture: StagePicture, inputs: StageCellInput[], options: StageOptions): Stage {
  const { width, cell, gap, reach, maxScale } = options
  const step = cell + gap
  const sides = options.sides && inputs.some((input) => bandOf(input, true) === 'left' || bandOf(input, true) === 'right')
  const side = sides ? cell + reach : 0
  const room = Math.max(1, width - 2 * side)
  const scale = Math.min(maxScale, room / Math.max(1, picture.width))
  const pictureWidth = picture.width * scale
  const pictureHeight = picture.height * scale
  const pictureX = (width - pictureWidth) / 2
  const middle: [number, number] = [picture.width / 2, picture.height / 2]
  const along = (input: StageCellInput, axis: 0 | 1) => (input.anchor ?? middle)[axis] * scale
  // first with the picture's top at 0; the whole is moved down at the end so that nothing is above 0
  const pointOf = (input: StageCellInput): [number, number] => [pictureX + along(input, 0), along(input, 1)]

  const bands: Record<Band, StageCellInput[]> = { top: [], bottom: [], left: [], right: [] }
  for (const input of inputs) bands[bandOf(input, sides)].push(input)
  // the sides first: what does not fit beside the picture goes below
  const sideRoom = Math.max(1, Math.floor((pictureHeight + 2 * reach + gap) / step))
  for (const band of ['left', 'right'] as const) {
    if (bands[band].length <= sideRoom) continue
    const sorted = [...bands[band]].sort((a, b) => a.depth - b.depth)
    bands[band] = sorted.slice(0, sideRoom)
    bands.bottom.push(...sorted.slice(sideRoom))
  }

  // what a cell may not cover: the weapon's parts (with room for the lines) and the cells already laid
  type Box = [number, number, number, number]
  const shapes: Box[] = (picture.boxes?.length ? picture.boxes : [[0, 0, picture.width, picture.height] as Box])
    .map(([left, top, right, bottom]) => [pictureX + left * scale - gap, top * scale - reach, pictureX + right * scale + gap, bottom * scale + reach])
  const laid: Box[] = []
  const blocked = (left: number, right: number) => [...shapes, ...laid.map(([a, b, c, d]): Box => [a - gap, b - gap, c + gap, d + gap])]
    .filter(([a, , c]) => a < right && c > left)

  const cells: StageCell[] = []
  const place = (input: StageCellInput, band: Band, x: number, y: number) => {
    const point = pointOf(input)
    const from: [number, number] = band === 'top' ? [x + cell / 2, y + cell] : band === 'bottom' ? [x + cell / 2, y] : [band === 'left' ? x + cell : x, y + cell / 2]
    cells.push({ key: input.key, band, x, y, point, from })
    laid.push([x, y, x + cell, y + cell])
  }

  for (const band of ['left', 'right'] as const) {
    const list = bands[band]
    if (!list.length) continue
    const starts = spread(list.map((input) => pointOf(input)[1]), cell, gap, -reach, pictureHeight + reach)
    list.forEach((input, index) => place(input, band, band === 'left' ? 0 : width - cell, starts[index]!))
  }

  // above and below, row by row from the weapon out: each cell as near its point as the parts and the laid cells let it
  const perRow = Math.max(1, Math.floor((width + gap) / step))
  for (const band of ['top', 'bottom'] as const) {
    const bandRows = rows(bands[band].map((input) => ({ input, along: along(input, 0) })), perRow)
    for (const row of bandRows) {
      const starts = spread(row.map(({ input }) => pointOf(input)[0]), cell, gap, 0, width)
      const placed = row.map(({ input }, index) => {
        const x = starts[index]!
        const point = pointOf(input)
        const under = blocked(x, x + cell)
        // above: the cell's bottom over every part and cell below it, and over its point; below: the other way round
        const y = band === 'top'
          ? Math.min(point[1] - reach, ...under.map(([, top]) => top)) - cell
          : Math.max(point[1] + reach, ...under.map(([, , , bottom]) => bottom))
        return { input, x, y }
      })
      // a row is laid at once: its cells do not stand on each other
      for (const { input, x, y } of placed) place(input, band, x, y)
    }
  }

  const top = Math.min(0, ...cells.map((entry) => entry.y))
  const bottom = Math.max(pictureHeight, ...cells.map((entry) => entry.y + cell))
  for (const entry of cells) { entry.y -= top; entry.point[1] -= top; entry.from[1] -= top }
  return { width, height: Math.ceil(bottom - top), picture: { x: pictureX, y: -top, scale }, cell, cells }
}
