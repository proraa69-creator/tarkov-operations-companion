import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { applyTables, byteTables, screenTables, type ScreenProfile } from './screenCurve'

const MAX_WIDTH = 1280

/** A dark scale for when there is no picture of the game yet: the shadows' steps show what a preset does to them. */
function testPattern(): ImageData | null {
  const width = 1280, height = 720
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  // Steps 0…64 of 255: the tones of a dark corridor.
  const steps = 17
  for (let step = 0; step < steps; step += 1) {
    const value = step * 4
    context.fillStyle = `rgb(${value},${value},${value})`
    context.fillRect(step * width / steps, 0, width / steps + 1, height * 0.55)
  }
  const gradient = context.createLinearGradient(0, 0, width, 0)
  gradient.addColorStop(0, '#000')
  gradient.addColorStop(1, '#fff')
  context.fillStyle = gradient
  context.fillRect(0, height * 0.6, width, height * 0.18)
  // A dim figure in a dark doorway.
  context.fillStyle = 'rgb(9,10,8)'
  context.fillRect(width * 0.38, height * 0.08, width * 0.24, height * 0.42)
  context.fillStyle = 'rgb(16,17,14)'
  context.beginPath()
  context.arc(width * 0.5, height * 0.17, 26, 0, Math.PI * 2)
  context.fill()
  context.fillRect(width * 0.47, height * 0.2, width * 0.06, height * 0.24)
  const colors = ['#5a1c14', '#1c4a24', '#1a2d5a', '#6b5a20']
  colors.forEach((color, index) => { context.fillStyle = color; context.fillRect(index * width / 4, height * 0.82, width / 4, height * 0.18) })
  return context.getImageData(0, 0, width, height)
}

/**
 * The game's picture cut in two: «До» on the left, «После» (the profile's tables, exactly what the monitor would show)
 * on the right. The line between them can be dragged.
 */
export function BeforeAfter({ src, profile, onPixels }: { src: string | null; profile: Omit<ScreenProfile, 'id' | 'name'>; onPixels?: (pixels: Uint8ClampedArray) => void }) {
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<{ src: string; data: ImageData | null } | null>(null)
  const pattern = useMemo(() => src ? null : testPattern(), [src])
  const original = src ? (loaded?.src === src ? loaded.data : null) : pattern
  const [split, setSplit] = useState(50)
  // Two short words, not dictionary phrases («До» starts many Russian sentences elsewhere).
  const en = useLocale().locale === 'en'
  const beforeLabel = en ? 'Before' : 'До', afterLabel = en ? 'After' : 'После'

  useEffect(() => {
    let cancelled = false
    if (!src) return
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const scale = Math.min(1, MAX_WIDTH / image.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      setLoaded({ src, data: context.getImageData(0, 0, canvas.width, canvas.height) })
    }
    image.onerror = () => { if (!cancelled) setLoaded({ src, data: testPattern() }) }
    image.src = src
    return () => { cancelled = true }
  }, [src])

  useEffect(() => {
    if (!original) return
    onPixels?.(original.data)
    const before = beforeRef.current
    if (!before) return
    before.width = original.width
    before.height = original.height
    before.getContext('2d')?.putImageData(original, 0, 0)
  }, [original, onPixels])

  useEffect(() => {
    const after = afterRef.current
    if (!original || !after) return
    const frame = requestAnimationFrame(() => {
      const copy = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height)
      applyTables(copy.data, byteTables(screenTables(profile)))
      after.width = original.width
      after.height = original.height
      after.getContext('2d')?.putImageData(copy, 0, 0)
    })
    return () => cancelAnimationFrame(frame)
  }, [original, profile])

  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || !(event.buttons & 1)) return
    setSplit(Math.min(98, Math.max(2, (event.clientX - box.left) / box.width * 100)))
  }

  return (
    <div className="screen-compare" ref={frameRef} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag(event) }} onPointerMove={drag}>
      <canvas ref={beforeRef} className="screen-compare-layer" aria-label={beforeLabel} />
      <canvas ref={afterRef} className="screen-compare-layer is-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }} aria-label={afterLabel} />
      <div className="screen-compare-line" style={{ left: `${split}%` }} aria-hidden="true"><span /></div>
      <span className="screen-compare-tag is-before">{beforeLabel}</span>
      <span className="screen-compare-tag is-after">{afterLabel}</span>
      {!src && <span className="screen-compare-note">{uiText('Шкала тёмных тонов — кадра из игры пока нет')}</span>}
    </div>
  )
}
