/**
 * A module's picture without its empty border, for the bench's cells (owner, 22.11.2026: «В окне оружейника картинки модулей по
 * прежнему маленькие»): the game's pictures of a part leave a third to a half of their square empty round it, so a grip or a
 * magazine stood in the middle of its cell as a speck. The picture is read once, cut to what is drawn in it (a pixel of margin
 * kept) and given back as an object address; a picture that cannot be read (another host without CORS) or is full already stays as
 * it was.
 */

/** Little enough to leave the picture as it is. */
const FULL = 0.9
const trimmed = new Map<string, Promise<string | null>>()

export function trimmedPicture(src: string): Promise<string | null> {
  let load = trimmed.get(src)
  if (!load) {
    load = trim(src).catch(() => null)
    trimmed.set(src, load)
  }
  return load
}

async function trim(src: string): Promise<string | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null
  const answer = await fetch(src, { mode: 'cors' })
  if (!answer.ok) return null
  const bitmap = await createImageBitmap(await answer.blob())
  const { width, height } = bitmap
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const { data } = context.getImageData(0, 0, width, height)
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= 8) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return null
  left = Math.max(0, left - 1); top = Math.max(0, top - 1); right = Math.min(width - 1, right + 1); bottom = Math.min(height - 1, bottom + 1)
  const cutWidth = right - left + 1
  const cutHeight = bottom - top + 1
  if (cutWidth * cutHeight >= FULL * width * height) return null
  const cut = document.createElement('canvas')
  cut.width = cutWidth
  cut.height = cutHeight
  cut.getContext('2d')?.drawImage(canvas, left, top, cutWidth, cutHeight, 0, 0, cutWidth, cutHeight)
  const blob = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, 'image/png'))
  return blob ? URL.createObjectURL(blob) : null
}
