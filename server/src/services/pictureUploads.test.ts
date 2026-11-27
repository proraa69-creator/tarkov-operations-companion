import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sniffImage } from './bugReportStore.js'

/**
 * «котик.png» with a program inside (owner, 28.11.2026, a video on Ghostscript): a file named .png whose first bytes are
 * PostScript reaches Ghostscript through an image preview (Pillow, ImageMagick) and runs commands on the server. Here every
 * picture the server takes is told by its first bytes, never by its name or the declared type; only PNG, JPEG and WEBP pass;
 * and nothing in the server hands a picture to a native image tool or a printer. The VPS has no Ghostscript, ImageMagick,
 * CUPS or Pillow either (checked 28.11.2026): keep it so.
 */
const SERVICES = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(SERVICES, '..')
const text = (value: string) => Buffer.from(value, 'latin1')

const DISGUISED: Array<[string, Buffer]> = [
  ['PostScript', text('%!PS-Adobe-3.0\nnewpath 120 80 moveto 300 340 lineto stroke showpage\n')],
  ['EPS', text('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n')],
  ['EPS with its binary header', Buffer.concat([Buffer.from([0xc5, 0xd0, 0xd3, 0xc6]), Buffer.alloc(40, 0)])],
  ['PDF', text('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n')],
  ['SVG', text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
  ['HTML', text('<!doctype html><script>alert(1)</script>')],
  ['GIF', text('GIF89a\x01\x00\x01\x00\x00\x00\x00')],
  ['a RIFF that is not WEBP', Buffer.concat([text('RIFF'), Buffer.from([40, 0, 0, 0]), text('AVI LIST'), Buffer.alloc(32, 0)])],
  ['PNG bytes cut short', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
]

test('a «котик.png» with PostScript, EPS, PDF, SVG or HTML inside is no picture to the server', () => {
  for (const [name, bytes] of DISGUISED) assert.equal(sniffImage(bytes), undefined, name)
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])), 'image/png')
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])), 'image/jpeg')
  assert.equal(sniffImage(Buffer.concat([text('RIFF'), Buffer.from([40, 0, 0, 0]), text('WEBPVP8 '), Buffer.alloc(32, 2)])), 'image/webp')
})

test('every store that takes a picture tells it by its first bytes', () => {
  for (const file of ['supportChatStore.ts', 'bugReportStore.ts', 'noticeStore.ts', 'questPointPhotoStore.ts', 'stickerStore.ts']) {
    assert.match(readFileSync(join(SERVICES, file), 'utf8'), /sniffImage\(/, file)
  }
  // The wiki's photos the server downloads itself: PNG or JPEG by their first bytes too.
  assert.match(readFileSync(join(SERVICES, 'guideImages.ts'), 'utf8'), /const isPicture = /)
})

test('nothing in the server hands a picture to Ghostscript, ImageMagick, a native image library or a printer', () => {
  const files: string[] = []
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path)
    }
  }
  walk(SOURCE)
  assert.ok(files.length > 50, 'the server sources were found')
  const LIBRARY = /from\s+['"](sharp|gm|imagemagick|jimp|canvas|@napi-rs\/canvas|pdfjs-dist|pdf2pic|ghostscript[^'"]*)['"]/
  const TOOL = /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*['"`](gs|gswin64c|gswin32c|magick|convert|gm|lp|lpr|inkscape|soffice|libreoffice)\b/
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, LIBRARY, file)
    assert.doesNotMatch(source, TOOL, file)
  }
})
