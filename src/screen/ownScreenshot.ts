import { useEffect, useState } from 'react'
import type { ScreenFrame } from './screenApi'

/** The first picture file of a paste or a drop, if any. */
export function pictureOf(data: DataTransfer | null | undefined): File | null {
  if (!data) return null
  for (const file of Array.from(data.files ?? [])) if (file.type.startsWith('image/')) return file
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}

function readPicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * The player's own screenshot for the «до/после» preview, pasted (Ctrl+V) or dropped onto the window while «Настройка
 * экрана» is open (owner, 28.10.2026: «перетаскивать в приложение скриншот. Либо Ctrl-C, Ctrl-V… Настроить. Без
 * включения игры»). Returns whether a file is being dragged over the window. A dropped file never opens in the window.
 */
export function useOwnScreenshot(enabled: boolean, onFrame: (frame: ScreenFrame) => void) {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const take = (file: File | null) => {
      if (!file) return false
      void readPicture(file).then((dataUrl) => onFrame({ dataUrl, at: Date.now(), source: 'own' })).catch(() => {})
      return true
    }
    const paste = (event: ClipboardEvent) => { if (take(pictureOf(event.clipboardData))) event.preventDefault() }
    const over = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false) }
    const drop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return
      event.preventDefault()
      setDragging(false)
      take(pictureOf(event.dataTransfer))
    }
    window.addEventListener('paste', paste)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('paste', paste)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      setDragging(false)
    }
  }, [enabled, onFrame])
  return dragging
}
