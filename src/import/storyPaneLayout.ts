/**
 * Where the parts of the story pane (Tasks → Story) sit on a game frame, so they can be read one by one.
 *
 * One OCR pass over the whole screen merges the columns (chapter icons, pane, «Предметы» panel) into one line of text:
 * the chapter name on the banner art came out as «“yp» instead of «Тур», the progress bar as «№8» and «1/3» as «1/5»
 * (EFT 1.2.0.0.47888, 1920×1080). The same frame read as three small pictures — chapter title, status label, objectives —
 * gives «Typ» (Latin look-alikes of «Тур»), «АКТИВНО» and «1/3».
 *
 * Fractions were measured on that 16:9 frame: pane text column x 160, pane right edge 1272, banner 97–245, «Главные
 * задачи» 407, bottom menu bar 1053. Any other screen is cut the same way inside the game's own
 * 16:9 menu area (gameUiBox).
 */
export interface PaneRect { x: number; y: number; width: number; height: number }
export interface OcrWordBox { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
export interface StoryPaneRects { title: PaneRect; status: PaneRect; body: PaneRect }
/** The story pane read part by part: banner title column, status label, description and objectives. */
export interface StoryPaneReading { title: string; status: string; body: string }

const FRACTION = {
  left: 0.075,
  right: 0.665,
  titleTop: 0.115,
  titleBottom: 0.205,
  titleWidth: 0.29,
  // Inside the status box only: 8 px of the banner art on its left turned «ACTIVE» into «seme» (English game, 14.10.2026).
  statusWidth: 0.075,
  bodyBottom: 0.955,
} as const

/** EFT's menus keep a 16:9 shape, centred on a screen of any other shape. */
const UI_RATIO = 16 / 9

/**
 * The game's 16:9 menu area on a frame of any size (owner, 31.10.2026: «программа сама должна определять какой размер
 * экрана и подстраивать поиск под каждый»): the whole frame at 16:9; the centred middle of a wider one (21:9, 32:9 — a
 * 21:9 player's chapters were never read: the menus sit between dark sides); the centred band of a taller one (16:10, 4:3).
 */
export function gameUiBox(size: { width: number; height: number }): PaneRect {
  const { width: W, height: H } = size
  if (W / H > UI_RATIO + 0.02) {
    const width = Math.round(H * UI_RATIO)
    return { x: Math.round((W - width) / 2), y: 0, width, height: H }
  }
  if (W / H < UI_RATIO - 0.02) {
    const height = Math.round(W / UI_RATIO)
    return { x: 0, y: Math.round((H - height) / 2), width: W, height }
  }
  return { x: 0, y: 0, width: W, height: H }
}

/** The header word «ИСТОРИЯ» (OCR sometimes keeps only «ТОРИЯ»); the English game's «CHAPTER», maybe in Cyrillic look-alikes. */
export function isStoryTitleText(text: string) {
  return /истори|тори[яи]|(?:^|\s)story(?:\s|$)|(?:^|\s)[cс][hн][aа][pр][tт][eе][rв]?(?=\s|$)/i.test(text)
}

/** The objective block headings of the story pane («Главные задачи», «Опциональные задачи»; the left edge may be cut). */
export function isStoryObjectivesText(text: string) {
  return /главн(?:ые|ая)\s*задач|[а-яё]{0,4}иональн[а-яё]*\s*задач|main\s+(?:tasks|objectives)|optional\s+(?:tasks|objectives)/i.test(text)
}

/**
 * The pane's own header on a whole-screen pass: «ИСТОРИЯ» (or the clipped «ТОРИЯ»), the English «CHAPTER». Never the
 * «СЮЖЕТНЫЕ» / «STORY» tab: that tab sits above every Tasks screen, the side table included.
 */
const PANE_HEADER = /истори|тори[яи]|(?:^|\s)[cс][hн][aа][pр][tт][eе][rв]?(?=\s|$)/i
const STORY_TAB = /сюжетн|(?:^|\s)story(?:\s|$)/i

/**
 * A full-screen reading that shows the story pane: the pane's own marks — its header or its objective blocks — under
 * the «Сюжетные» tab, or both of them. The «STORY» tab alone is not the pane: the English side table showed it on every
 * frame and cost two or three part reads a look (audit P5c).
 */
export function isStoryPaneOcr(text: string) {
  const objectives = isStoryObjectivesText(text)
  const header = PANE_HEADER.test(text)
  return (header && objectives) || ((header || objectives) && STORY_TAB.test(text))
}

/**
 * The game's stamp at the bottom of the screen: its version, the server and the mode («1.2.5.0.48146 | LOCAL | PvE»,
 * «… | G4X0HW | PvP S…»). OCR read it into «Небеса в огне» and «Случайный свидетель» as an objective (owner,
 * 28.10.2026: «нашёл название сервера снизу… снизу экрана не брать информацию»).
 */
const GAME_STAMP = /\d+\.\d+\.\d+\.\d+\.\d{3,}|\|\s*(?:local|pv[pe])\b|(?:^|\s)[A-Z0-9]{5,8}\s*\|\s*pv[pe]/i

/** The text without the game's stamp lines. */
export function withoutGameStamp(text: string) {
  return text.split(/\r?\n/).filter((line) => !GAME_STAMP.test(line)).join('\n')
}

/** A word of the stamp: the version number, or the mode / server marks next to it at the bottom of the frame. */
const STAMP_WORD = /^\d+\.\d+\.\d+\.\d+\.\d{3,}|^(?:local|pv[pe])$/i

/** One text the story parsers read: title column, status, then description and objectives (never the game's stamp). */
export function storyPaneText(pane: StoryPaneReading) {
  return [pane.title, pane.status, pane.body].map((part) => withoutGameStamp(part).trim()).filter(Boolean).join('\n')
}

/**
 * The three regions to read. `words` are the word boxes of a full-screen pass over the same image; with them the regions
 * follow the real layout (any aspect ratio), without them the measured fractions are taken inside the game's menu area (gameUiBox), on a screen of any shape.
 * `objectivesFromAnchor` starts the body at «Главные задачи» instead of under the banner: the description is skipped,
 * but only for this frame — another chapter's description has another length.
 */
export function storyPaneRects(size: { width: number; height: number }, words: OcrWordBox[] = [], objectivesFromAnchor = false): StoryPaneRects | undefined {
  const { width: FW, height: FH } = size
  if (!(FW >= 640 && FH >= 360)) return undefined
  // Every fraction below is of the game's menu area (gameUiBox), not of the whole screen: a 21:9 or 16:10 screen is cut
  // like a 16:9 one, then moved back onto the frame.
  const { x: X, y: Y, width: W, height: H } = gameUiBox(size)
  const find = (pattern: RegExp, where: (box: OcrWordBox['bbox']) => boolean = () => true) =>
    words.find((word) => pattern.test(word.text.trim()) && where(word.bbox))?.bbox
  // The English game (owner's screenshots, 14.10.2026): «CHAPTER», «Main / Optional objectives», «Task items on
  // character» over the right panel, «MAIN MENU» in the bottom bar.
  const history = find(/истори|тори[яи]|^[cс][hн][aа][pр][tт]/i, (box) => box.y0 - Y < H * 0.35)
  const main = find(/^главн(?:ые|ая)$|^main$/i, (box) => box.y0 - Y > H * 0.15 && box.y0 - Y < H * 0.9)
    ?? find(/^[а-яё]{0,4}иональн|^optional$/i, (box) => box.y0 - Y > H * 0.15 && box.y0 - Y < H * 0.9)
  // The right panel: its top header, or either of its headers «Предметы для заданий …» / «Task items …» anywhere down
  // the right half (the owner's «Тур», 15.10.2026: the body reached the panel and read «Предмет:» into an objective).
  const headers = words.filter((word, index) => word.bbox.x0 - X > W * 0.5
    && /^(?:предметы\s+для|task\s+items)$/i.test(`${word.text.trim()} ${words[index + 1]?.text.trim() ?? ''}`)).map((word) => word.bbox)
  const top = find(/^предметы$|^task$/i, (box) => box.y0 - Y < H * 0.12 && box.x0 - X > W * 0.5)
  const panel = [top, ...headers].filter((box): box is OcrWordBox['bbox'] => Boolean(box)).sort((a, b) => a.x0 - b.x0)[0]
  const menu = find(/^главное$|main\s*menu$/i, (box) => box.y0 - Y > H * 0.9)
  // The game's stamp (version, server, mode) under the pane: the body stops above it.
  const stamp = find(STAMP_WORD, (box) => box.y0 - Y > H * 0.8)

  const left = main ? main.x0 - W * 0.012 : X + W * FRACTION.left
  const right = panel ? panel.x0 - W * 0.02 : X + W * FRACTION.right
  const titleTop = history ? history.y0 - H * 0.01 : Y + H * FRACTION.titleTop
  const titleBottom = history ? history.y1 + H * 0.05 : Y + H * FRACTION.titleBottom
  const bodyTop = objectivesFromAnchor && main ? main.y0 - H * 0.012 : titleBottom + H * 0.025
  const bodyBottom = Math.min(menu ? menu.y0 - H * 0.01 : Y + H * FRACTION.bodyBottom, stamp ? stamp.y0 - H * 0.005 : Infinity)

  const rect = (x0: number, y0: number, x1: number, y1: number): PaneRect | undefined => {
    const x = Math.max(0, Math.round(x0))
    const y = Math.max(0, Math.round(y0))
    const width = Math.min(FW, Math.round(x1)) - x
    const height = Math.min(FH, Math.round(y1)) - y
    return width >= 40 && height >= 12 ? { x, y, width, height } : undefined
  }
  const title = rect(left, titleTop, Math.min(right, left + W * FRACTION.titleWidth), titleBottom)
  const status = rect(right - W * FRACTION.statusWidth, titleTop + H * 0.005, right, titleBottom - H * 0.015)
  const body = rect(left, bodyTop, right, bodyBottom)
  return title && status && body ? { title, status, body } : undefined
}

/** OCR word boxes of a tesseract.js result (`blocks` output). */
export function ocrWordBoxes(blocks: Array<{ paragraphs: Array<{ lines: Array<{ words: OcrWordBox[] }> }> }> | null | undefined): OcrWordBox[] {
  return (blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)))
}
