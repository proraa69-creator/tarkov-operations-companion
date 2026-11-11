/**
 * A picture over the report's 5 MB (a 4K game screenshot in PNG often is): drawn smaller as a JPEG that fits, under the
 * same file name with «.jpg», so the coordinates the game wrote into the name stay readable («Добавить точку»,
 * src/components/SuggestPointSection.tsx). Undefined when the browser cannot read or encode it.
 */
export async function shrinkScreenshot(file: File, maxBytes: number): Promise<File | undefined> {
  let source: (CanvasImageSource & { width: number; height: number }) | undefined
  try {
    source = await createImageBitmap(file)
  } catch {
    return undefined
  }
  const name = file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg'
  for (const side of [2560, 1920, 1280]) {
    const scale = Math.min(1, side / Math.max(source.width, source.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(source.width * scale))
    canvas.height = Math.max(1, Math.round(source.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    if (blob && blob.size <= maxBytes) return new File([blob], name, { type: 'image/jpeg' })
  }
  return undefined
}
