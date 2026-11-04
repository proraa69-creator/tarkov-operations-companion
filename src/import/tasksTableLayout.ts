/**
 * Where the Tasks table («Персонаж» → «Задания» → «Побочные») is on a game frame, from the picture itself: its rows, its
 * scrollbar, which tab is open, and the cells to read. Owner, 04.11.2026: «Обнаружение должно быть четкое. Смотри название
 * квестов, и должно быть стопроцентное совпадание» (docs/quests/quest-state-engine.md «A whole read of the Tasks table»).
 *
 * Why not the whole-screen pass: on a real frame (a player's, 1920×810, EFT 1.3.0.0) it merges the columns and read 4 of 9 titles
 * exactly; the title column alone, one picture at the frame's own size, read 9 of 9 (and the 5 of a sharper frame). A bigger
 * scale reads worse: «Часть 10» came out «Часть 18», «TerraGroup» in Cyrillic.
 *
 * Fractions are of the game's 16:9 menu picture (gameUiBox), measured on that frame's 1440×810 area, where the table's own view
 * is y 105-785, its rows 77.2 high, and the scrollbar's thumb a bright stripe at x 947-951 on a dark track of the view's height.
 */
export interface TableRect { x: number; y: number; width: number; height: number }
export interface TablePicture { width: number; height: number; /** BGRA, 4 bytes a pixel. */ data: Uint8Array }

export interface TasksTableLayout {
  /** Rows whose text is in view, top to bottom, in the picture's pixels. */
  rows: Array<{ top: number; bottom: number }>
  rowHeight: number
  view: { top: number; bottom: number }
  thumb: { top: number; bottom: number } | null
  /** The list's first row is in view: the thumb is at the top of its track. */
  atTop: boolean
  /** The list's last row is in view: the thumb is at the bottom of its track. */
  atBottom: boolean
  /** The whole list is on the page: no thumb to move, at most TABLE_FIT_ROWS rows, and blank space under the last one. */
  fits: boolean
  /** The view's share of the list (the thumb against its track); null without a thumb. */
  share: number | null
  /** How many rows the view holds. */
  pageRows: number
  /** «Побочные» is the open tab. */
  sideTab: boolean
  titles: TableRect
  statuses: TableRect
  search: TableRect
}

/** The view holds 8.8 rows: with 8 there is blank space under the last, with 9 the list scrolls. */
export const TABLE_FIT_ROWS = 8

const ROW_HEIGHT = 77.2 / 810
const VIEW_TOP = 105 / 810
const VIEW_BOTTOM = 785 / 810
const THUMB_BAND = { from: 0.65, to: 0.668 }
const THUMB_BRIGHT = 110
const THUMB_MIN_HEIGHT = 0.02
const THUMB_WIDTH = { min: 2, max: 14 }
/** How close to its track's end the thumb is at that end. */
const THUMB_END_SLACK = 0.004
/** Where a row's text may be and still be read whole: this share of a row around its middle. */
const ROW_TEXT_BAND = 0.16
/** Blank right end of the title cell: separators are read there. */
const SEPARATOR_XS = [0.385, 0.389, 0.393]
const TITLES = { from: 197 / 1440, to: 570 / 1440 }
const STATUSES = { from: 690 / 1440, to: 798 / 1440 }
const SEARCH = { x: 692 / 1440, y: 38 / 810, width: 253 / 1440, height: 26 / 810 }
/** Strips of the tabs' backgrounds, above their words: the open tab's is near white, the others about a third of it. */
const TAB_STRIP = { top: 38 / 810, bottom: 42 / 810 }
const TABS = { story: { from: 12 / 1440, to: 160 / 1440 }, side: { from: 172 / 1440, to: 312 / 1440 }, operational: { from: 322 / 1440, to: 500 / 1440 } }
const TAB_OPEN = 170

function brightness(picture: TablePicture, x: number, y: number) {
  const at = (y * picture.width + x) * 4
  return (picture.data[at]! + picture.data[at + 1]! + picture.data[at + 2]!) / 3
}

function stripMean(picture: TablePicture, from: number, to: number) {
  const { width, height } = picture
  const left = Math.round(from * width)
  const right = Math.round(to * width)
  const top = Math.round(TAB_STRIP.top * height)
  const bottom = Math.max(top + 1, Math.round(TAB_STRIP.bottom * height))
  let sum = 0
  let count = 0
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 2) { sum += brightness(picture, x, y); count += 1 }
  return count ? sum / count : 0
}

/** The thumb: the one narrow bright stripe in the band beside the table. */
function findThumb(picture: TablePicture, viewTop: number, viewBottom: number): { top: number; bottom: number } | null {
  const { width, height } = picture
  const least = Math.round(THUMB_MIN_HEIGHT * height)
  const columns: Array<{ x: number; top: number; bottom: number }> = []
  for (let x = Math.round(THUMB_BAND.from * width); x <= Math.round(THUMB_BAND.to * width); x += 1) {
    let start = -1
    let best: { top: number; bottom: number } | null = null
    for (let y = viewTop; y <= viewBottom + 1; y += 1) {
      const on = y <= viewBottom && brightness(picture, x, y) >= THUMB_BRIGHT
      if (on && start < 0) start = y
      if (!on && start >= 0) {
        if (y - start >= least && (!best || y - 1 - start > best.bottom - best.top)) best = { top: start, bottom: y - 1 }
        start = -1
      }
    }
    if (best) columns.push({ x, ...best })
  }
  if (columns.length < THUMB_WIDTH.min || columns.length > THUMB_WIDTH.max) return null
  // One stripe, side by side, all of one height.
  const first = columns[0]!
  if (columns.some((column, index) => column.x !== first.x + index || Math.abs(column.top - first.top) > 2 || Math.abs(column.bottom - first.bottom) > 2)) return null
  return { top: first.top, bottom: first.bottom }
}

/** The dark lines between rows, in the blank right end of the title cell. */
function findSeparators(picture: TablePicture, viewTop: number, viewBottom: number) {
  const { width } = picture
  const xs = SEPARATOR_XS.map((fraction) => Math.round(fraction * width))
  const line = new Array<number>(viewBottom + 1).fill(0)
  for (let y = viewTop; y <= viewBottom; y += 1) line[y] = xs.reduce((sum, x) => sum + brightness(picture, x, y), 0) / xs.length
  const reach = Math.max(4, Math.round(picture.height * 0.008))
  const found: number[] = []
  let run: number[] = []
  const close = () => {
    if (run.length) found.push((run[0]! + run[run.length - 1]!) / 2)
    run = []
  }
  for (let y = viewTop; y <= viewBottom; y += 1) {
    const above = y - reach >= viewTop ? line[y - reach]! : null
    const below = y + reach <= viewBottom ? line[y + reach]! : null
    const around = Math.max(above ?? 0, below ?? 0)
    if (around >= 16 && line[y]! <= around * 0.6) run.push(y)
    else close()
  }
  close()
  return found
}

/** The table on a game's 16:9 menu picture; null when no row grid is there. */
export function findTasksTable(picture: TablePicture): TasksTableLayout | null {
  const { width, height } = picture
  if (!width || !height || picture.data.length < width * height * 4) return null
  const view = { top: Math.round(VIEW_TOP * height), bottom: Math.round(VIEW_BOTTOM * height) }
  const expected = ROW_HEIGHT * height
  const lines = findSeparators(picture, view.top, view.bottom)
  // The row grid: the lines a row apart; another line (a word's stroke over the sample) is not one of them.
  const steps = lines.slice(1).map((line, index) => line - lines[index]!).filter((step) => Math.abs(step - expected) <= expected * 0.12)
  if (!steps.length) return null
  const rowHeight = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)]!
  const grid: number[] = []
  for (const line of lines) {
    const last = grid[grid.length - 1]
    if (last === undefined) { grid.push(line); continue }
    const rows = Math.round((line - last) / rowHeight)
    if (rows >= 1 && Math.abs(line - last - rows * rowHeight) <= Math.max(3, rowHeight * 0.06)) {
      for (let step = 1; step < rows; step += 1) grid.push(last + step * rowHeight)
      grid.push(line)
    }
  }
  if (grid.length < 2) return null
  const thumb = findThumb(picture, view.top, view.bottom)
  const viewHeight = view.bottom - view.top
  const share = thumb ? (thumb.bottom - thumb.top + 1) / viewHeight : null
  const scrolls = Boolean(thumb && share! < 0.97)
  const slack = Math.max(2, THUMB_END_SLACK * height)
  const inView = ({ top, bottom }: { top: number; bottom: number }) => {
    const middle = (top + bottom) / 2
    const band = rowHeight * ROW_TEXT_BAND
    return middle - band >= view.top && middle + band <= view.bottom
  }
  const rows: TasksTableLayout['rows'] = []
  const firstLine = grid[0]!
  const lastLine = grid[grid.length - 1]!
  // Lines the glare over the first rows hides: the grid goes on up while a row's text is in view.
  for (let lines = Math.ceil((firstLine - view.top) / rowHeight); lines >= 1; lines -= 1) {
    const above = { top: firstLine - lines * rowHeight, bottom: firstLine - (lines - 1) * rowHeight }
    if (inView(above)) rows.push(above)
  }
  for (let index = 1; index < grid.length; index += 1) rows.push({ top: grid[index - 1]!, bottom: grid[index]! })
  // Under the last line: a row cut by the view while the list scrolls, blank space when it does not.
  const after = { top: lastLine, bottom: lastLine + rowHeight }
  if (scrolls && inView(after)) rows.push(after)
  // Blank, not a row cut by the view with its thumb missed: no row's fill under the last line.
  const fill = (top: number, bottom: number) => {
    const y = Math.round((top + bottom) / 2)
    return SEPARATOR_XS.reduce((sum, fraction) => sum + brightness(picture, Math.round(fraction * width), y), 0) / SEPARATOR_XS.length
  }
  const rowFill = fill(lastLine - rowHeight, lastLine)
  const blankBelow = view.bottom - lastLine >= rowHeight * 0.3 && Math.abs(fill(lastLine, Math.min(view.bottom, lastLine + rowHeight)) - rowFill) > rowFill * 0.25
  const fits = !scrolls && rows.length <= TABLE_FIT_ROWS && blankBelow && Math.abs(rows[0]!.top - view.top) <= rowHeight * 0.1
  // No thumb and no blank space: the thumb may be what was missed, and this says nothing about either end of the list.
  const atTop = scrolls ? thumb!.top - view.top <= slack : fits
  const atBottom = scrolls ? view.bottom - thumb!.bottom <= slack : fits
  const rect = (from: number, to: number): TableRect => ({ x: Math.round(from * width), y: view.top, width: Math.round((to - from) * width), height: viewHeight })
  return {
    rows,
    rowHeight,
    view,
    thumb,
    atTop,
    atBottom,
    fits,
    share: scrolls ? share : null,
    pageRows: viewHeight / rowHeight,
    sideTab: stripMean(picture, TABS.side.from, TABS.side.to) >= TAB_OPEN && stripMean(picture, TABS.story.from, TABS.story.to) < TAB_OPEN && stripMean(picture, TABS.operational.from, TABS.operational.to) < TAB_OPEN,
    titles: rect(TITLES.from, TITLES.to),
    statuses: rect(STATUSES.from, STATUSES.to),
    search: { x: Math.round(SEARCH.x * width), y: Math.round(SEARCH.y * height), width: Math.round(SEARCH.width * width), height: Math.round(SEARCH.height * height) },
  }
}

/** A status cell on the whole-screen pass's text: worth looking for the table's cells. The scanner still decides what the screen is. */
export function mayBeTasksTable(text: string) {
  return /активно|выполнено|провалено|\bactive[!l1|]?(?![a-z])|\bcompleted?!|\bfailed\b/i.test(text)
}

/** What was read on a frame's table: one per row in view, and how the frame sits in the list. */
export interface TasksTableReading {
  rows: Array<{ title: string; status: string }>
  /** Text in no row where the list leaves blank space: a row the grid did not see. */
  stray: boolean
  atTop: boolean
  atBottom: boolean
  fits: boolean
  share: number | null
  pageRows: number
  /** Where the list is scrolled to: readings at two of these are two independent readings. */
  scroll: number
  sideTab: boolean
  /** The «Поиск» field as read: its placeholder when nothing is typed. */
  search: string
}

export interface TableTextLine { text: string; top: number; bottom: number }

const LETTERS = /[\p{L}\p{N}]/gu
const letters = (text: string) => text.match(LETTERS)?.length ?? 0

/** Each row's cell text: the lines whose middle is in it, the cursor's and an icon's bits (under three letters) left out when a line has more. */
function cellsOf(rows: TasksTableLayout['rows'], lines: TableTextLine[]) {
  return rows.map(({ top, bottom }) => {
    const own = lines.filter((line) => { const middle = (line.top + line.bottom) / 2; return middle >= top && middle < bottom }).map((line) => line.text.trim()).filter(Boolean)
    const words = own.filter((text) => letters(text) >= 3)
    return (words.length ? words : own).join(' ')
  })
}

/** The readings of a frame's cells, placed on its rows. `lines`: in the picture's pixels. */
export function tasksTableReading(layout: TasksTableLayout, titleLines: TableTextLine[], statusLines: TableTextLine[], search: string): TasksTableReading {
  const titles = cellsOf(layout.rows, titleLines)
  const statuses = cellsOf(layout.rows, statusLines)
  const last = layout.rows[layout.rows.length - 1]
  const stray = layout.fits && Boolean(last) && titleLines.some((line) => letters(line.text) >= 3 && (line.top + line.bottom) / 2 >= last!.bottom)
  return {
    rows: titles.map((title, index) => ({ title, status: statuses[index] ?? '' })),
    stray,
    atTop: layout.atTop,
    atBottom: layout.atBottom,
    fits: layout.fits,
    share: layout.share,
    pageRows: layout.pageRows,
    scroll: layout.thumb?.top ?? 0,
    sideTab: layout.sideTab,
    search,
  }
}
