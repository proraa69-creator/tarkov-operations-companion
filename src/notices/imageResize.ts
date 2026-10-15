import { NOTICE_LIMITS } from '../shared/notices'

/** The photo types an announcement takes (checked again by the server by their first bytes). */
export const NOTICE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** A photo smaller than this and within NOTICE_LIMITS.imageSide is sent as it is. */
const SEND_AS_IS_BYTES = 1.5 * 1024 * 1024

export interface PreparedImage { data: string; mime: string; size: number; preview: string }

function readDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать фото'))
    reader.readAsDataURL(blob)
  })
}

async function decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource } | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file)
      return { width: bitmap.width, height: bitmap.height, source: bitmap }
    }
  } catch { /* fall back to <img> */ }
  try {
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return { width: image.naturalWidth, height: image.naturalHeight, source: image }
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}

function encode(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
}

/**
 * A photo for an announcement (owner app and website): a large one is scaled down to NOTICE_LIMITS.imageSide on its
 * longest side and saved as WEBP (JPEG where the browser cannot), so it travels and loads quickly; a small one goes as
 * it is. Throws with the reason for another type or a photo still over 5 MB.
 */
export async function prepareNoticeImage(file: File): Promise<PreparedImage> {
  if (!NOTICE_IMAGE_TYPES.includes(file.type)) throw new Error('Фото: только JPG, PNG или WEBP')
  let blob: Blob = file
  const decoded = await decode(file)
  const side = decoded ? Math.max(decoded.width, decoded.height) : 0
  if (decoded && (side > NOTICE_LIMITS.imageSide || file.size > SEND_AS_IS_BYTES)) {
    const scale = Math.min(1, NOTICE_LIMITS.imageSide / side)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    const context = canvas.getContext('2d')
    if (context) {
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
      let smaller = await encode(canvas, 'image/webp')
      if (!smaller || smaller.type !== 'image/webp') smaller = await encode(canvas, 'image/jpeg')
      if (smaller && NOTICE_IMAGE_TYPES.includes(smaller.type) && (smaller.size < file.size || side > NOTICE_LIMITS.imageSide)) blob = smaller
    }
  }
  if (blob.size > NOTICE_LIMITS.imageBytes) throw new Error('Фото больше 5 МБ')
  const preview = await readDataUrl(blob)
  return { data: preview.slice(preview.indexOf(',') + 1), mime: blob.type || file.type, size: blob.size, preview }
}
