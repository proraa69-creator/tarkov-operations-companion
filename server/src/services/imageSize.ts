import type { ImageMime } from './bugReportStore.js'

/**
 * Width × height of a PNG, JPEG or WEBP from its header, without decoding it (no image library on the server); undefined
 * when the header cannot be read. Used for the support chat's screenshots (services/supportChatStore.ts): the apps size
 * the thumbnail before the image arrives.
 */
export function imageSize(data: Buffer, mime: ImageMime): { width: number; height: number } | undefined {
  const size = mime === 'image/png' ? pngSize(data) : mime === 'image/jpeg' ? jpegSize(data) : webpSize(data)
  return size && size.width > 0 && size.height > 0 ? size : undefined
}

/** The IHDR chunk right after the signature. */
function pngSize(data: Buffer) {
  if (data.length < 24 || data.toString('latin1', 12, 16) !== 'IHDR') return undefined
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/** The first start-of-frame segment (SOF0–SOF15 but DHT, JPG and DAC), walking the segments from the start. */
function jpegSize(data: Buffer) {
  let at = 2
  while (at + 4 <= data.length) {
    if (data[at] !== 0xff) return undefined
    const marker = data[at + 1]!
    // Fill bytes before a marker.
    if (marker === 0xff) { at += 1; continue }
    // Markers without a length: TEM and RST0–RST7.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue }
    // End of image or start of scan before any frame: nothing to read.
    if (marker === 0xd9 || marker === 0xda) return undefined
    const length = data.readUInt16BE(at + 2)
    if (length < 2) return undefined
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > data.length) return undefined
      return { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) }
    }
    at += 2 + length
  }
  return undefined
}

/** The first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X). */
function webpSize(data: Buffer) {
  if (data.length < 30) return undefined
  const chunk = data.toString('latin1', 12, 16)
  if (chunk === 'VP8 ') {
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return undefined
    return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (data[20] !== 0x2f) return undefined
    const bits = data.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 }
  return undefined
}
