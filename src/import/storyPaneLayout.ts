/**
 * Where the parts of the story pane (Tasks → Story) sit on a game frame, so they can be read one by one.
 *
 * One OCR pass over the whole screen merges the columns (chapter icons, pane, «Предметы» panel) into one line of text:
 * the chapter name on the banner art came out as «“yp» instead of «Тур», the progress bar as «№8» and «1/3» as «1/5»
 * (EFT 1.2.0.0.47888, 1920×1080). The same frame read as three small pictures — chapter title, status label, objectives —
 * gives «Typ» (Latin look-alikes of «Тур»), «АКТИВНО» and «1/3».
 *
 * Fractions were measured on that 16:9 frame: pane text column x 160, pane right edge 1272, banner 97–245, «Главные
 * задачи» 407, bottom menu bar 1053. Other aspect ratios are read only when the anchors were found by a full-screen pass.
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
  statusWidth: 0.08,
  bodyBottom: 0.955,
} as const

/** The header word «ИСТОРИЯ» (OCR sometimes keeps only «ТОРИЯ»). */
export function isStoryTitleText(text: string) {
  return /истори|тори[яи]|(?:^|\s)story(?:\s|$)/i.test(text)
}

/** The objective block headings of the story pane («Главные задачи», «Опциональные задачи»; the left edge may be cut). */
export function isStoryObjectivesText(text: string) {
  return /главн(?:ые|ая)\s*задач|[а-яё]{0,4}иональн[а-яё]*\s*задач|main\s+(?:tasks|objectives)|optional\s+(?:tasks|objectives)/i.test(text)
}

/** A full-screen reading that shows the story pane: the header or the objective blocks under the «Сюжетные» tab. */
export function isStoryPaneOcr(text: string) {
  const objectives = isStoryObjectivesText(text)
  return (isStoryTitleText(text) && (objectives || /сюжетн|story/i.test(text))) || (objectives && /сюжетн/i.test(text))
}

/** One text the story parsers read: title column, status, then description and objectives. */
export function storyPaneText(pane: StoryPaneReading) {
  return [pane.title, pane.status, pane.body].map((part) => part.trim()).filter(Boolean).join('\n')
}

/**
 * The three regions to read. `words` are the word boxes of a full-screen pass over the same image; with them the regions
 * follow the real layout (any aspect ratio), without them only a 16:9 frame is cut by the measured fractions.
 * `objectivesFromAnchor` starts the body at «Главные задачи» instead of under the banner: the description is skipped,
 * but only for this frame — another chapter's description has another length.
 */
export function storyPaneRects(size: { width: number; height: number }, words: OcrWordBox[] = [], objectivesFromAnchor = false): StoryPaneRects | undefined {
  const { width: W, height: H } = size
  if (!(W >= 640 && H >= 360)) return undefined
  const find = (pattern: RegExp, where: (box: OcrWordBox['bbox']) => boolean = () => true) =>
    words.find((word) => pattern.test(word.text.trim()) && where(word.bbox))?.bbox
  const history = find(/истори|тори[яи]/i, (box) => box.y0 < H * 0.35)
  const main = find(/^главн(?:ые|ая)$/i, (box) => box.y0 > H * 0.15) ?? find(/^[а-яё]{0,4}иональн/i, (box) => box.y0 > H * 0.15)
  const panel = find(/^предметы$/i, (box) => box.y0 < H * 0.12 && box.x0 > W * 0.5)
  const menu = find(/^главное$/i, (box) => box.y0 > H * 0.9)
  const ratio = W / H
  if (!history && !main && (ratio < 1.7 || ratio > 1.85)) return undefined

  const left = main ? main.x0 - W * 0.012 : W * FRACTION.left
  const right = panel ? panel.x0 - W * 0.02 : W * FRACTION.right
  const titleTop = history ? history.y0 - H * 0.01 : H * FRACTION.titleTop
  const titleBottom = history ? history.y1 + H * 0.05 : H * FRACTION.titleBottom
  const bodyTop = objectivesFromAnchor && main ? main.y0 - H * 0.012 : titleBottom + H * 0.025
  const bodyBottom = menu ? menu.y0 - H * 0.01 : H * FRACTION.bodyBottom

  const rect = (x0: number, y0: number, x1: number, y1: number): PaneRect | undefined => {
    const x = Math.max(0, Math.round(x0))
    const y = Math.max(0, Math.round(y0))
    const width = Math.min(W, Math.round(x1)) - x
    const height = Math.min(H, Math.round(y1)) - y
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
