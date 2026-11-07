/**
 * The fonts of the sticker editor's words (src/admin/stickers/stickerLayout.ts STICKER_FONTS), bundled with the app and
 * loaded only when the editor opens — no outside font service. All under the SIL Open Font License 1.1, each with its
 * Cyrillic and Latin parts (the licence texts next to them in src/assets/fonts/stickers/):
 *   Oswald (already the app's own, src/assets/fonts/), Montserrat Black, Rubik Mono One, Pacifico, Pixelify Sans Bold.
 */
import oswaldCyrillic from '../../assets/fonts/oswald-cyrillic.woff2?url'
import oswaldLatin from '../../assets/fonts/oswald-latin.woff2?url'
import montserratCyrillic from '../../assets/fonts/stickers/montserrat-cyrillic-900-normal.woff2?url'
import montserratLatin from '../../assets/fonts/stickers/montserrat-latin-900-normal.woff2?url'
import rubikCyrillic from '../../assets/fonts/stickers/rubik-mono-one-cyrillic-400-normal.woff2?url'
import rubikLatin from '../../assets/fonts/stickers/rubik-mono-one-latin-400-normal.woff2?url'
import pacificoCyrillic from '../../assets/fonts/stickers/pacifico-cyrillic-400-normal.woff2?url'
import pacificoLatin from '../../assets/fonts/stickers/pacifico-latin-400-normal.woff2?url'
import pixelCyrillic from '../../assets/fonts/stickers/pixelify-sans-cyrillic-700-normal.woff2?url'
import pixelLatin from '../../assets/fonts/stickers/pixelify-sans-latin-700-normal.woff2?url'
import { STICKER_FONTS } from './stickerLayout'

const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

const FILES: Record<string, [string, string]> = {
  oswald: [oswaldCyrillic, oswaldLatin],
  montserrat: [montserratCyrillic, montserratLatin],
  'rubik-mono': [rubikCyrillic, rubikLatin],
  pacifico: [pacificoCyrillic, pacificoLatin],
  pixel: [pixelCyrillic, pixelLatin],
}

let loading: Promise<void> | null = null

/** Adds the fonts to the page once and waits for them (a font that does not load falls back; the editor still works). */
export function loadStickerFonts(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return
    const faces = STICKER_FONTS.flatMap((font) => {
      const [cyrillic, latin] = FILES[font.id] ?? []
      if (!cyrillic || !latin) return []
      return [[cyrillic, CYRILLIC], [latin, LATIN]].map(([url, range]) => new FontFace(font.family, `url(${url}) format("woff2")`, { weight: String(font.weight), unicodeRange: range, display: 'block' }))
    })
    await Promise.all(faces.map(async (face) => {
      try { document.fonts.add(await face.load()) } catch { /* the fallback font draws it */ }
    }))
  })()
  return loading
}
