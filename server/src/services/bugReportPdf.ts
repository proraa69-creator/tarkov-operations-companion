/**
 * A bug report or an idea («Ваши предложения») as a PDF for the owner's mailbox (owner, 11.10.2026: «пересылать мне данную
 * заявку в пдф файле на почту»): the report's number, date (Moscow time), the reporter's e-mail, app version and system,
 * topic, description and the screenshots or photos, one under another, scaled to the page. A4, DejaVu Sans (Cyrillic;
 * fonts/dejavuSans.ts).
 *
 * JPEG screenshots go in as they are; PNG ones are re-compressed by pdf-lib. WEBP cannot be embedded in a PDF: such a
 * screenshot is listed by number and `skipped`, so the mail sends the original file next to the PDF.
 */
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { BugReportView, ImageMime } from './bugReportStore.js'
import { DEJAVU_SANS, DEJAVU_SANS_BOLD } from './fonts/dejavuSans.js'

export interface BugReportPdfInput extends Omit<BugReportView, 'files'> {
  files: Array<{ idx: number; mime: ImageMime; data: Uint8Array }>
}

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const WIDTH = A4[0] - 2 * MARGIN
const INK = rgb(0.09, 0.11, 0.1)
const DIM = rgb(0.4, 0.43, 0.41)
const ACCENT = rgb(0.6, 0.46, 0.17)
const RULE = rgb(0.84, 0.85, 0.82)
/** Screenshots embedded together at most (a mail with attachments must stay well under the provider's 40 MB). */
const IMAGE_BUDGET = 20 * 1024 * 1024
/**
 * A PNG is decoded in full to go into the PDF (about 2.5 s and 250 MB for an 8K screenshot): past this many pixels in
 * one report, PNGs are attached as files instead. A small file may claim a huge image (a decompression bomb), and the
 * server must neither unpack it nor stall on several big ones. One 8K or four 4K screenshots still go into the PDF.
 */
const PNG_PIXEL_BUDGET = 36_000_000

/**
 * Width × height of a plain PNG: exactly one IHDR, right after the signature, and no APNG frames. pdf-lib's decoder
 * takes the size of every IHDR it meets and of every animation frame, so anything else could still claim a huge
 * image: 0 for it, as for a file that cannot be read.
 */
export function pngPixels(data: Uint8Array) {
  if (data.length < 24) return 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let pixels = 0
  for (let offset = 8; offset + 8 <= data.length;) {
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8))
    if (type === 'IHDR') {
      if (offset !== 8) return 0
      pixels = view.getUint32(16) * view.getUint32(20)
    } else if (offset === 8 || type === 'acTL' || type === 'fcTL' || type === 'fdAT') return 0
    if (type === 'IEND') break
    offset += 12 + view.getUint32(offset)
  }
  return pixels
}

const moscow = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Lays text out top to bottom, starting new pages as it goes. */
class Writer {
  page: PDFPage
  y: number
  private readonly known: Set<number>

  constructor(private readonly doc: PDFDocument, readonly regular: PDFFont, readonly bold: PDFFont) {
    this.page = doc.addPage(A4)
    this.y = A4[1] - MARGIN
    this.known = new Set(regular.getCharacterSet())
  }

  newPage() {
    this.page = this.doc.addPage(A4)
    this.y = A4[1] - MARGIN
  }

  /** Room for `height` points below the cursor, else a new page. */
  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage()
  }

  /** What the font can draw: tabs as spaces, other control characters dropped, anything else unknown as □. */
  clean(text: string) {
    let out = ''
    for (const char of text.replace(/\t/g, '    ').replace(/\r\n?/g, '\n')) {
      const code = char.codePointAt(0)!
      if (char === '\n') out += char
      else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue
      else out += this.known.has(code) ? char : '□'
    }
    return out
  }

  /** Lines no wider than `width`: words wrap, a word longer than a line breaks where it must. */
  wrap(text: string, font: PDFFont, size: number, width: number) {
    const lines: string[] = []
    for (const paragraph of this.clean(text).split('\n')) {
      let line = ''
      for (const word of paragraph.split(' ')) {
        const next = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue }
        if (line) lines.push(line)
        let piece = ''
        for (const char of word) {
          if (font.widthOfTextAtSize(piece + char, size) > width && piece) { lines.push(piece); piece = '' }
          piece += char
        }
        line = piece
      }
      lines.push(line)
    }
    return lines
  }

  text(text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = options.size ?? 10.5
    const font = options.font ?? this.regular
    const indent = options.indent ?? 0
    const lineHeight = size * 1.42
    for (const line of this.wrap(text, font, size, WIDTH - indent)) {
      this.ensure(lineHeight)
      this.y -= lineHeight
      if (line) this.page.drawText(line, { x: MARGIN + indent, y: this.y + size * 0.28, size, font, color: options.color ?? INK })
    }
    this.y -= options.gap ?? 0
  }

  heading(text: string) {
    this.ensure(34)
    this.y -= 14
    this.text(text, { size: 12.5, font: this.bold, gap: 4 })
  }

  rule() {
    this.ensure(14)
    this.y -= 8
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4[0] - MARGIN, y: this.y }, thickness: 0.6, color: RULE })
    this.y -= 6
  }

  /** «Label: value» rows, the labels in one column. */
  facts(rows: Array<[string, string]>) {
    const size = 10.5
    const column = Math.max(...rows.map(([label]) => this.bold.widthOfTextAtSize(this.clean(label), size))) + 14
    for (const [label, value] of rows) {
      const lines = this.wrap(value || '—', this.regular, size, WIDTH - column)
      this.ensure(size * 1.42 * lines.length)
      this.y -= size * 1.42
      this.page.drawText(this.clean(label), { x: MARGIN, y: this.y + size * 0.28, size, font: this.bold, color: DIM })
      lines.forEach((line, index) => {
        if (index) this.y -= size * 1.42
        this.page.drawText(line, { x: MARGIN + column, y: this.y + size * 0.28, size, font: this.regular, color: INK })
      })
    }
  }

  image(image: PDFImage, caption: string) {
    const captionHeight = 20
    const maxHeight = A4[1] - 2 * MARGIN - captionHeight
    const scale = Math.min(1, WIDTH / image.width, maxHeight / image.height)
    const width = image.width * scale, height = image.height * scale
    this.ensure(height + captionHeight)
    this.y -= captionHeight
    this.page.drawText(this.clean(caption), { x: MARGIN, y: this.y + 6, size: 9.5, font: this.bold, color: DIM })
    this.y -= height
    this.page.drawImage(image, { x: MARGIN, y: this.y, width, height })
    this.page.drawRectangle({ x: MARGIN, y: this.y, width, height, borderColor: RULE, borderWidth: 0.6 })
    this.y -= 12
  }
}

/** The report as a PDF; `skipped`: screenshots (by idx) that are not in it and go with the mail as files. */
export async function bugReportPdf(report: BugReportPdfInput): Promise<{ pdf: Uint8Array; skipped: number[] }> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(Buffer.from(DEJAVU_SANS, 'base64'), { subset: false })
  const bold = await doc.embedFont(Buffer.from(DEJAVU_SANS_BOLD, 'base64'), { subset: false })
  const idea = report.kind === 'idea'
  doc.setTitle(`Raid OS — ${idea ? 'предложение' : 'отчёт об ошибке'} №${report.id}`)
  doc.setAuthor(report.email ?? 'Raid OS')
  doc.setSubject(report.topic)
  doc.setCreator('Raid OS')
  doc.setProducer('Raid OS server')
  doc.setCreationDate(new Date(report.createdAt))

  const out = new Writer(doc, regular, bold)
  out.text('RAID OS', { size: 9.5, font: bold, color: ACCENT })
  out.text(`${idea ? 'Предложение' : 'Отчёт об ошибке'} №${report.id}`, { size: 20, font: bold, gap: 2 })
  out.text(`${moscow.format(new Date(report.createdAt))} (МСК)`, { size: 10.5, color: DIM })
  out.rule()
  out.facts([
    ['E-mail', report.email ?? 'аккаунт удалён'],
    ['Аккаунт', report.accountId ?? '—'],
    ['Версия приложения', report.appVersion],
    ['Система', report.platform],
    ['Статус', report.status === 'closed' ? 'закрыт' : 'открыт'],
    [idea ? 'Изображения' : 'Скриншоты', report.files.length ? String(report.files.length) : 'нет'],
  ])
  out.heading('Тема')
  out.text(report.topic)
  out.heading('Описание')
  out.text(report.description)

  const skipped: number[] = []
  if (report.files.length) {
    out.heading(`${idea ? 'Изображения' : 'Скриншоты'} · ${report.files.length}`)
    let budget = IMAGE_BUDGET
    let pixelBudget = PNG_PIXEL_BUDGET
    for (const file of report.files) {
      const name = `${idea ? 'Изображение' : 'Скриншот'} ${file.idx + 1}`
      let image: PDFImage | undefined
      const pixels = file.mime === 'image/png' ? pngPixels(file.data) : 0
      const tooLarge = file.mime === 'image/png' && (pixels === 0 || pixels > pixelBudget)
      if (file.mime !== 'image/webp' && !tooLarge && file.data.length <= budget) {
        pixelBudget -= pixels
        try {
          image = file.mime === 'image/jpeg' ? await doc.embedJpg(file.data) : await doc.embedPng(file.data)
        } catch { image = undefined }
      }
      if (image) {
        budget -= file.data.length
        out.image(image, name)
      } else {
        skipped.push(file.idx)
        out.text(`${name}: ${file.mime === 'image/webp' ? 'формат WEBP в PDF не вставляется' : pixels > PNG_PIXEL_BUDGET ? 'слишком большое изображение для PDF' : 'не вставлен в PDF'} — файл приложен к письму.`, { color: DIM })
      }
    }
  }
  return { pdf: await doc.save(), skipped }
}
