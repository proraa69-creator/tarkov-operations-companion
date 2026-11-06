import { isChipLink, type QuestLinkKind, type QuestTreeLane, type QuestTreeLink, type QuestTreeModel, type QuestTreeStep } from './questTreeModel'

/**
 * Where everything of «Дерево квестов» stands. A lane reads like the game goes on: each loyalty level is a row, its stages
 * (the first dialogue, a line level by level) follow one another on the row's rail from left to right, each stage's quests
 * hang under it, and a chain goes right from its quest. A quest's whole subtree keeps a band of its own, so nothing overlaps
 * and a chain stays together; an extra requirement is an extra line.
 */
export const TREE_SIZE = {
  padding: 28,
  gutter: 14,
  stepWidth: 132,
  stepHeight: 38,
  indent: 22,
  cardWidth: 216,
  cardHeight: 44,
  chipHeight: 28,
  columnGap: 36,
  rowGap: 6,
  railGap: 10,
  blockGap: 24,
  rowsGap: 22,
  laneHeader: 46,
  laneGap: 16,
} as const

export interface TreeBox {
  key: string
  kind: 'quest' | 'step' | 'chip'
  laneKey: string
  x: number
  y: number
  width: number
  height: number
  /** A quest box: its quest. A chip: the other trader's quest it leads to. */
  questId?: string
  step?: QuestTreeStep
  /** A chip: on the way into this trader's quest (`in`) or out of it (`out`). */
  direction?: 'in' | 'out'
}

export interface TreeEdge {
  key: string
  kind: QuestLinkKind | 'step' | 'trunk'
  path: string
  /** The quests the line joins (a chip counts as its quest), for the chain that lights up. */
  from?: string
  to?: string
}

export interface TreeLaneBand {
  lane: QuestTreeLane
  top: number
  height: number
}

export interface QuestTreeLayout {
  width: number
  height: number
  bands: TreeLaneBand[]
  boxes: TreeBox[]
  edges: TreeEdge[]
  questBoxes: ReadonlyMap<string, TreeBox>
}

interface Tidy { box: TreeBox; kids: Tidy[] }

/** A box's column inside its stage's block: the first quests just under the stage, each further one a column to the right. */
const columnX = (rank: number) => TREE_SIZE.indent + (rank - 1) * (TREE_SIZE.cardWidth + TREE_SIZE.columnGap)

const shift = (node: Tidy, by: number) => {
  node.box.y += by
  for (const kid of node.kids) shift(kid, by)
}

/** Lays a subtree from `top` down; a parent stands in the middle of its children. Returns the band's bottom. */
function place(node: Tidy, top: number): number {
  if (!node.kids.length) {
    node.box.y = top
    return top + node.box.height
  }
  let cursor = top
  for (const kid of node.kids) cursor = place(kid, cursor) + TREE_SIZE.rowGap
  let bottom = cursor - TREE_SIZE.rowGap
  const first = node.kids[0].box
  const last = node.kids[node.kids.length - 1].box
  node.box.y = (first.y + last.y + last.height) / 2 - node.box.height / 2
  if (node.box.y < top) {
    const by = top - node.box.y
    for (const kid of node.kids) shift(kid, by)
    node.box.y = top
    bottom += by
  }
  return Math.max(bottom, node.box.y + node.box.height)
}

const curve = (from: TreeBox, to: TreeBox) => {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const middle = (x1 + x2) / 2
  return `M${x1} ${y1}C${middle} ${y1} ${middle} ${y2} ${x2} ${y2}`
}

/** From under the stage down its side and right into the quest. */
const elbow = (step: TreeBox, to: TreeBox) => {
  const x = step.x + TREE_SIZE.indent / 2
  const y = to.y + to.height / 2
  const radius = 6
  return `M${x} ${step.y + step.height}V${y - radius}Q${x} ${y} ${x + radius} ${y}H${to.x}`
}

/** Rows of a lane: the consecutive stages of one loyalty level. */
function laneRows(lane: QuestTreeLane) {
  const rows: QuestTreeStep[][] = []
  let current: number | undefined
  for (const step of lane.steps) {
    if (rows.length && step.ll === current) rows[rows.length - 1].push(step)
    else rows.push([step])
    current = step.ll
  }
  return rows
}

/** `laneKeys`: only these lanes (one trader's tree); default all. */
export function layoutQuestTree(model: QuestTreeModel, laneKeys?: ReadonlySet<string>): QuestTreeLayout {
  const boxes: TreeBox[] = []
  const edges: TreeEdge[] = []
  const questBoxes = new Map<string, TreeBox>()
  const bands: TreeLaneBand[] = []
  let width = 0
  let top = TREE_SIZE.padding / 2

  for (const lane of model.lanes) {
    if (laneKeys && !laneKeys.has(lane.key)) continue
    const laneTop = top
    const lines: Array<{ key: string; path: () => string; kind: TreeEdge['kind']; from?: string; to?: string }> = []
    const crossIn = (id: string) => (model.incoming.get(id) ?? []).filter(isChipLink)
    const crossOut = (id: string) => (model.outgoing.get(id) ?? []).filter(isChipLink)
    let block: TreeBox[] = []
    const add = (box: TreeBox) => { block.push(box); return box }

    const chip = (link: QuestTreeLink, direction: 'in' | 'out', rank: number): Tidy => ({
      kids: [],
      box: add({
        key: `chip:${direction}:${link.from}:${link.to}`, kind: 'chip', laneKey: lane.key, direction,
        questId: direction === 'in' ? link.from : link.to,
        x: columnX(rank), y: 0, width: TREE_SIZE.cardWidth, height: TREE_SIZE.chipHeight,
      }),
    })
    const inChip = (link: QuestTreeLink, rank: number): Tidy => {
      const node = chip(link, 'in', rank)
      // the quest's box is made after its chips, so the line looks it up when it is drawn
      lines.push({ key: node.box.key, kind: link.kind, from: link.from, to: link.to, path: () => curve(node.box, questBoxes.get(link.to)!) })
      return node
    }
    /** A quest with whatever stands beside it: the chips of the quests it opens that also need another trader's quest. */
    const withSideChips = (ids: string[]): Tidy[] => ids.flatMap((id) => [
      ...(model.children.get(id) ?? []).flatMap((childId) => crossIn(childId).map((link) => inChip(link, model.ranks.get(id)!))),
      questNode(id),
    ])
    const questNode = (id: string): Tidy => {
      const box = add({
        key: `quest:${id}`, kind: 'quest', laneKey: lane.key, questId: id,
        x: columnX(model.ranks.get(id)!), y: 0, width: TREE_SIZE.cardWidth, height: TREE_SIZE.cardHeight,
      })
      questBoxes.set(id, box)
      const outChips = crossOut(id).map((link) => {
        const node = chip(link, 'out', model.ranks.get(id)! + 1)
        lines.push({ key: node.box.key, kind: link.kind, from: link.from, to: link.to, path: () => curve(box, node.box) })
        return node
      })
      return { box, kids: [...withSideChips(model.children.get(id) ?? []), ...outChips] }
    }

    let y = laneTop + TREE_SIZE.laneHeader
    let previousRowFirst: TreeBox | undefined
    for (const row of laneRows(lane)) {
      let x = TREE_SIZE.padding
      let previous: TreeBox | undefined
      let rowBottom = y + TREE_SIZE.stepHeight
      for (const step of row) {
        block = []
        const stepBox = add({ key: `step:${step.key}`, kind: 'step', laneKey: lane.key, step, x: 0, y, width: TREE_SIZE.stepWidth, height: TREE_SIZE.stepHeight })
        let cursor = y + TREE_SIZE.stepHeight + TREE_SIZE.railGap
        for (const root of step.roots) {
          const [first, ...rest] = crossIn(root)
          const nodes: Tidy[] = []
          let hanging: () => TreeBox
          if (!first) {
            nodes.push(...withSideChips([root]))
            hanging = () => questBoxes.get(root)!
          } else {
            // The other trader's quest stands first: the stage, the chip, the quest.
            nodes.push(...rest.map((link) => inChip(link, 1)))
            const lead = inChip(first, 1)
            lead.kids = withSideChips([root])
            nodes.push(lead)
            hanging = () => lead.box
          }
          for (const node of nodes) cursor = place(node, cursor) + TREE_SIZE.rowGap
          lines.push({ key: `from-step:${root}`, kind: 'step', path: () => elbow(stepBox, hanging()) })
        }
        const right = Math.max(...block.map((box) => box.x + box.width))
        for (const box of block) box.x += x
        boxes.push(...block)
        rowBottom = Math.max(rowBottom, cursor - TREE_SIZE.rowGap)
        if (previous) {
          const from = previous
          lines.push({ key: `rail:${step.key}`, kind: 'trunk', path: () => `M${from.x + from.width} ${y + TREE_SIZE.stepHeight / 2}H${stepBox.x}` })
        }
        previous = stepBox
        x += right + TREE_SIZE.blockGap
      }
      // The rows join on the left, in the game's order.
      const first = boxes.find((box) => box.kind === 'step' && box.step === row[0])!
      const middle = first.y + first.height / 2
      const above = previousRowFirst
      lines.push({ key: `trunk:${row[0].key}`, kind: 'trunk', path: () => `M${TREE_SIZE.gutter} ${above ? above.y + above.height / 2 : middle}V${middle}H${first.x}` })
      previousRowFirst = first
      y = rowBottom + TREE_SIZE.rowsGap
    }

    for (const link of model.links) {
      if (isChipLink(link) || model.laneOf.get(link.to) !== lane.key) continue
      lines.push({ key: `link:${link.from}:${link.to}`, kind: link.kind, from: link.from, to: link.to, path: () => curve(questBoxes.get(link.from)!, questBoxes.get(link.to)!) })
    }
    for (const line of lines) edges.push({ key: line.key, kind: line.kind, path: line.path(), ...(line.from ? { from: line.from } : {}), ...(line.to ? { to: line.to } : {}) })

    const height = y - TREE_SIZE.rowsGap - laneTop + TREE_SIZE.padding / 2
    bands.push({ lane, top: laneTop, height })
    top = laneTop + height + TREE_SIZE.laneGap
    for (const box of boxes) if (box.laneKey === lane.key) width = Math.max(width, box.x + box.width)
  }

  return { width: width + TREE_SIZE.padding, height: Math.max(top - TREE_SIZE.laneGap + TREE_SIZE.padding / 2, TREE_SIZE.padding), bands, boxes, edges, questBoxes }
}
