import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, Brush, Crop, Eraser, ImagePlus, LoaderCircle, Move, Plus, RotateCcw, Save, Scissors, Trash2, Type, Undo2, X } from 'lucide-react'
import { uiText } from '../../i18n/renderText'
import { closeSegmenter, segmentPerson } from './personSegmenter'
import { loadStickerFonts } from './stickerFonts'
import {
  cleanColor, confidenceToMask, fitView, frameToSource, fullMask, maskBounds, maskCoverage, MIN_PERSON_COVERAGE, newTextLayer, panView, sourceSize,
  STICKER_FONTS, STICKER_SIDE, strokeBrush, STROKE_MAX, TEXT_MAX_CHARS, TEXT_SIZE, textAt, zoomAround,
  type Point, type TextLayer, type TextLayout, type TextPlace, type View,
} from './stickerLayout'
import { canvas2d, drawSticker, exportSticker, updateCut, type StickerPhoto } from './stickerRender'
import './stickers.css'

type Tool = 'move' | 'erase' | 'restore' | 'text'
type Step = 'pick' | 'cutting' | 'edit'

const TOOLS: Array<{ id: Tool; label: string; icon: typeof Move }> = [
  { id: 'move', label: 'Двигать', icon: Move },
  { id: 'erase', label: 'Стереть', icon: Eraser },
  { id: 'restore', label: 'Вернуть', icon: Brush },
  { id: 'text', label: 'Текст', icon: Type },
]
const PLACES: Array<{ id: TextPlace; label: string }> = [
  { id: 'top', label: 'Сверху' },
  { id: 'bottom', label: 'Снизу' },
  { id: 'free', label: 'Где угодно' },
]
const BRUSH = { min: 6, max: 80, initial: 26 } as const
const UNDO_KEPT = 12

/** A photo of the phone's library or camera, decoded (the browser turns it the right way up). */
async function readPhoto(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/**
 * «Новый стикер» of the iPhone admin (owner, 07.11.2026: «я загружаю фотографию, фотография должна обрезаться по размеру
 * человечка, персонажа какого-то. И я могу делать надписи разных шрифтов, стилей и так далее. И сохранять стикеры»):
 *   1. «Выбрать фото» opens the phone's photo library or camera;
 *   2. the person is cut out on the phone (personSegmenter.ts); none found, the whole photo stays to be cut by hand;
 *   3. «Двигать» (a finger moves it, two fingers or «Размер» zoom it, «По центру», «Обводка»), «Стереть» / «Вернуть» (a
 *      brush, «Отменить», «Вырезать снова», «Всё фото»), «Текст» (lines of words: font, size, colour, outline, shadow, at
 *      the top, the bottom or anywhere by a finger);
 *   4. «Сохранить» uploads a transparent 512 × 512 PNG (stickerRender.ts) through `onSave`.
 * Loaded only when it opens (src/admin/stickers/StickerPacksSheet.tsx), with the segmenter and the fonts.
 */
export function StickerEditor({ onCancel, onSave }: { onCancel: () => void; onSave: (png: string) => Promise<void> }) {
  const [step, setStep] = useState<Step>('pick')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [tool, setTool] = useState<Tool>('move')
  const [brush, setBrush] = useState<number>(BRUSH.initial)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [baseScale, setBaseScale] = useState(1)
  const [texts, setTexts] = useState<TextLayer[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [outline, setOutline] = useState(false)
  const [saving, setSaving] = useState(false)
  const [undoCount, setUndoCount] = useState(0)
  const [fontsReady, setFontsReady] = useState(false)
  const [hasAuto, setHasAuto] = useState(false)
  const photo = useRef<StickerPhoto | null>(null)
  /** The segmenter's own cut, for «Вырезать снова». */
  const autoMask = useRef<Uint8ClampedArray | null>(null)
  const undo = useRef<Uint8ClampedArray[]>([])
  const preview = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const layouts = useRef<TextLayout[]>([])
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ kind: 'pan' | 'pinch' | 'brush' | 'text'; last: Point; distance?: number; view?: View; middle?: Point; text?: number; offset?: Point } | null>(null)
  const cursor = useRef<Point | null>(null)
  // What the pointer handlers and `draw` read between React's renders.
  const state = useRef({ view, texts, outline, selected, tool, brush })
  useLayoutEffect(() => { state.current = { view, texts, outline, selected, tool, brush } })

  useEffect(() => {
    let alive = true
    void loadStickerFonts().then(() => { if (alive) setFontsReady(true) })
    return () => { alive = false; closeSegmenter() }
  }, [])

  /** Draws the preview as it is now (also between React's renders, while the brush moves). */
  const draw = useCallback(() => {
    const canvas = preview.current
    const current = photo.current
    const context = canvas?.getContext('2d')
    if (!canvas || !current || !context) return
    const { view: shown, texts: words, outline: ring, selected: chosen, tool: using, brush: radius } = state.current
    const brushing = (using === 'erase' || using === 'restore') && cursor.current
    layouts.current = drawSticker(context, { photo: current, view: shown, texts: words, outline: ring }, {
      preview: true, selected: using === 'text' ? chosen : null, brush: brushing ? { ...cursor.current!, radius } : null,
    })
  }, [])
  useEffect(() => { if (step === 'edit') draw() }, [step, view, texts, outline, selected, tool, fontsReady, draw])

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setNotice('')
    setStep('cutting')
    try {
      const image = await readPhoto(file)
      const size = sourceSize(image.naturalWidth, image.naturalHeight)
      const { canvas: source, context } = canvas2d(size.width, size.height)
      context.drawImage(image, 0, 0, size.width, size.height)
      URL.revokeObjectURL(image.src)
      const pixels = context.getImageData(0, 0, size.width, size.height)
      const confidence = await segmentPerson(source)
      let mask = confidence ? confidenceToMask(confidence) : null
      if (mask && maskCoverage(mask) < MIN_PERSON_COVERAGE) {
        mask = null
        setNotice('Человека не нашли — сотрите фон кистью')
      } else if (!mask) setNotice('Авто-вырезание не сработало — сотрите фон кистью')
      autoMask.current = mask ? mask.slice() : null
      setHasAuto(Boolean(mask))
      const kept = mask ?? fullMask(size.width, size.height)
      const { canvas: cut } = canvas2d(size.width, size.height)
      photo.current = { width: size.width, height: size.height, pixels, mask: kept, cut }
      updateCut(photo.current)
      undo.current = []
      setUndoCount(0)
      const fitted = fitView(size.width, size.height, mask ? maskBounds(kept, size.width, size.height) : null)
      setView(fitted)
      setBaseScale(fitted.scale)
      setTool(mask ? 'move' : 'erase')
      setStep('edit')
    } catch {
      setStep(photo.current ? 'edit' : 'pick')
      setError('Не удалось открыть фото')
    }
  }

  /** The mask as it was before the next change, for «Отменить». */
  const remember = () => {
    const current = photo.current
    if (!current) return
    undo.current.push(current.mask.slice())
    if (undo.current.length > UNDO_KEPT) undo.current.shift()
    setUndoCount(undo.current.length)
  }
  const setMask = (mask: Uint8ClampedArray) => {
    const current = photo.current
    if (!current) return
    remember()
    current.mask.set(mask)
    updateCut(current)
    draw()
  }
  const stepBack = () => {
    const current = photo.current
    const last = undo.current.pop()
    setUndoCount(undo.current.length)
    if (!current || !last) return
    current.mask.set(last)
    updateCut(current)
    draw()
  }
  const recentre = () => {
    const current = photo.current
    if (!current) return
    const fitted = fitView(current.width, current.height, maskBounds(current.mask, current.width, current.height))
    setView(fitted)
    setBaseScale(fitted.scale)
  }

  const updateText = (id: number, change: Partial<TextLayer>) => setTexts((all) => all.map((layer) => (layer.id === id ? { ...layer, ...change } : layer)))
  const addText = () => {
    const layer = newTextLayer(texts, uiText('Текст'))
    setTexts((all) => [...all, layer])
    setSelected(layer.id)
    setTool('text')
  }
  const removeText = (id: number) => {
    setTexts((all) => all.filter((layer) => layer.id !== id))
    setSelected(null)
  }

  /** A pointer on the preview, in frame points. */
  const framePoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: ((event.clientX - box.left) / Math.max(1, box.width)) * STICKER_SIDE, y: ((event.clientY - box.top) / Math.max(1, box.height)) * STICKER_SIDE }
  }
  const brushAt = (from: Point, to: Point) => {
    const current = photo.current
    if (!current) return
    const { view: shown, tool: using, brush: radius } = state.current
    const changed = strokeBrush(current.mask, current.width, current.height, frameToSource(shown, from), frameToSource(shown, to), radius / shown.scale, using === 'restore' ? 'restore' : 'erase')
    updateCut(current, changed)
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (step !== 'edit') return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = framePoint(event)
    pointers.current.set(event.pointerId, point)
    const { tool: using, view: shown, texts: words } = state.current
    if (pointers.current.size === 2) {
      // Two fingers: zoom and move, whatever the tool.
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      gesture.current = { kind: 'pinch', last: point, distance: Math.hypot(a.x - b.x, a.y - b.y), view: shown, middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      cursor.current = null
      draw()
      return
    }
    if (pointers.current.size > 2) return
    const hit = using === 'text' || using === 'move' ? textAt(words, layouts.current, point) : undefined
    if (hit) {
      setSelected(hit.id)
      if (using !== 'text') setTool('text')
      const box = layouts.current[words.indexOf(hit)]?.box
      const centre = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : point
      gesture.current = { kind: 'text', last: point, text: hit.id, offset: { x: centre.x - point.x, y: centre.y - point.y } }
      return
    }
    if (using === 'erase' || using === 'restore') {
      remember()
      cursor.current = point
      brushAt(point, point)
      gesture.current = { kind: 'brush', last: point }
      draw()
      return
    }
    if (using === 'text') { setSelected(null); return }
    gesture.current = { kind: 'pan', last: point }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    const point = framePoint(event)
    pointers.current.set(event.pointerId, point)
    const current = gesture.current
    if (!current) return
    if (current.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const zoomed = zoomAround(current.view!, distance / Math.max(1, current.distance!), current.middle!)
      setView(panView(zoomed, middle.x - current.middle!.x, middle.y - current.middle!.y))
    } else if (current.kind === 'pan') {
      const dx = point.x - current.last.x
      const dy = point.y - current.last.y
      setView((shown) => panView(shown, dx, dy))
    } else if (current.kind === 'brush') {
      brushAt(current.last, point)
      cursor.current = point
      draw()
    } else if (current.kind === 'text') {
      updateText(current.text!, { place: 'free', x: point.x + current.offset!.x, y: point.y + current.offset!.y })
    }
    current.last = point
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) {
      gesture.current = null
      cursor.current = null
      draw()
    } else if (gesture.current?.kind === 'pinch') {
      // One finger left: it goes on moving the photo.
      const [rest] = [...pointers.current.values()]
      gesture.current = rest ? { kind: 'pan', last: rest } : null
    }
  }

  const save = async () => {
    const current = photo.current
    if (!current || saving) return
    setSaving(true)
    setError('')
    try {
      const { data } = await exportSticker({ photo: current, view, texts, outline })
      await onSave(data)
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : 'Не удалось сохранить стикер')
      setSaving(false)
    }
  }

  const layer = texts.find((entry) => entry.id === selected)
  const zoom = Math.round((view.scale / Math.max(0.0001, baseScale)) * 100)

  return <div className="admin-sheet-backdrop sticker-editor-backdrop">
    <section className="panel admin-user-sheet sticker-editor" role="dialog" aria-modal="true" aria-label={uiText('Новый стикер')}>
      <header className="admin-sheet-head">
        <button type="button" className="icon-button" onClick={onCancel} aria-label={uiText('Назад')} disabled={saving}><ArrowLeft size={18} /></button>
        <div><strong>{uiText('Новый стикер')}</strong><small>{uiText(step === 'edit' ? 'Прозрачный PNG 512×512' : 'Фото с персонажем')}</small></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label={uiText('Закрыть')} disabled={saving}><X size={18} /></button>
      </header>
      <input ref={fileInput} type="file" accept="image/*" hidden aria-label={uiText('Фото')} onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
      <div className="admin-sheet-scroll sticker-editor-body">
        {step === 'pick' && <div className="sticker-editor-pick">
          <button type="button" className="button primary sticker-editor-pick-button" onClick={() => fileInput.current?.click()}><ImagePlus size={20} />{uiText('Выбрать фото')}</button>
          <small>{uiText('Из галереи или с камеры. Персонаж вырежется сам.')}</small>
        </div>}
        {step === 'cutting' && <div className="sticker-editor-pick" role="status"><LoaderCircle className="spin" size={26} /><span>{uiText('Вырезаем персонажа…')}</span></div>}
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {step === 'edit' && <>
          {notice && <div className="sticker-editor-notice" role="status">{uiText(notice)}</div>}
          <canvas ref={preview} className={`sticker-editor-canvas is-${tool}`} width={STICKER_SIDE} height={STICKER_SIDE} aria-label={uiText('Стикер')}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          <div className="sticker-editor-tools" role="tablist" aria-label={uiText('Инструменты')}>
            {TOOLS.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tool === id} className={tool === id ? 'active' : ''} onClick={() => setTool(id)}><Icon size={17} /><span>{uiText(label)}</span></button>)}
          </div>

          {tool === 'move' && <div className="sticker-editor-panel">
            <label className="sticker-editor-range"><span>{uiText('Размер')}</span>
              <input type="range" min={30} max={300} value={Math.min(300, Math.max(30, zoom))} onChange={(event) => {
                const wanted = (Number(event.target.value) / 100) * baseScale
                setView((shown) => zoomAround(shown, wanted / shown.scale, { x: STICKER_SIDE / 2, y: STICKER_SIDE / 2 }))
              }} />
              <strong>{zoom}%</strong>
            </label>
            <div className="sticker-editor-row">
              <button type="button" className="button small" onClick={recentre}><Crop size={15} />{uiText('По центру')}</button>
              <button type="button" className={`button small${outline ? ' primary' : ''}`} aria-pressed={outline} onClick={() => setOutline((on) => !on)}>{uiText('Обводка')}</button>
              <button type="button" className="button small ghost" onClick={() => fileInput.current?.click()}><ImagePlus size={15} />{uiText('Другое фото')}</button>
            </div>
            <small className="sticker-editor-hint">{uiText('Двигайте пальцем, двумя пальцами — размер')}</small>
          </div>}

          {(tool === 'erase' || tool === 'restore') && <div className="sticker-editor-panel">
            <label className="sticker-editor-range"><span>{uiText('Кисть')}</span>
              <input type="range" min={BRUSH.min} max={BRUSH.max} value={brush} onChange={(event) => setBrush(Number(event.target.value))} />
              <strong>{brush}</strong>
            </label>
            <div className="sticker-editor-row">
              <button type="button" className="button small" disabled={!undoCount} onClick={stepBack}><Undo2 size={15} />{uiText('Отменить')}</button>
              {hasAuto && <button type="button" className="button small" onClick={() => { if (autoMask.current) setMask(autoMask.current) }}><Scissors size={15} />{uiText('Вырезать снова')}</button>}
              <button type="button" className="button small ghost" onClick={() => { if (photo.current) setMask(fullMask(photo.current.width, photo.current.height)) }}><RotateCcw size={15} />{uiText('Всё фото')}</button>
            </div>
            <small className="sticker-editor-hint">{uiText(tool === 'erase' ? 'Проведите по лишнему фону' : 'Проведите там, где стёрли лишнее')}</small>
          </div>}

          {tool === 'text' && <div className="sticker-editor-panel">
            <div className="sticker-editor-row sticker-editor-layers" role="group" aria-label={uiText('Надписи')}>
              {texts.map((entry) => <button key={entry.id} type="button" className={`button small${entry.id === selected ? ' primary' : ''}`} aria-pressed={entry.id === selected} onClick={() => setSelected(entry.id)}>{entry.text.trim().slice(0, 14) || '…'}</button>)}
              <button type="button" className="button small ghost" onClick={addText} disabled={texts.length >= 4}><Plus size={15} />{uiText('Надпись')}</button>
            </div>
            {layer ? <div className="sticker-editor-text">
              <textarea className="input" rows={2} maxLength={TEXT_MAX_CHARS} value={layer.text} aria-label={uiText('Текст надписи')} onChange={(event) => updateText(layer.id, { text: event.target.value })} />
              <div className="sticker-editor-fonts" role="radiogroup" aria-label={uiText('Шрифт')}>
                {STICKER_FONTS.map((font) => <button key={font.id} type="button" role="radio" aria-checked={layer.font === font.id} className={layer.font === font.id ? 'active' : ''} style={{ fontFamily: `"${font.family}", sans-serif`, fontWeight: font.weight }} onClick={() => updateText(layer.id, { font: font.id })}>{font.name}</button>)}
              </div>
              <label className="sticker-editor-range"><span>{uiText('Размер')}</span>
                <input type="range" min={TEXT_SIZE.min} max={TEXT_SIZE.max} value={layer.size} onChange={(event) => updateText(layer.id, { size: Number(event.target.value) })} />
                <strong>{layer.size}</strong>
              </label>
              <div className="sticker-editor-row">
                <label className="sticker-editor-color"><span>{uiText('Цвет')}</span><input type="color" value={layer.color} onChange={(event) => updateText(layer.id, { color: cleanColor(event.target.value, layer.color) })} /></label>
                <label className="sticker-editor-color"><span>{uiText('Обводка')}</span><input type="color" value={layer.stroke} onChange={(event) => updateText(layer.id, { stroke: cleanColor(event.target.value, layer.stroke) })} /></label>
                <label className="sticker-editor-check"><input type="checkbox" checked={layer.shadow} onChange={(event) => updateText(layer.id, { shadow: event.target.checked })} /><span>{uiText('Тень')}</span></label>
              </div>
              <label className="sticker-editor-range"><span>{uiText('Толщина')}</span>
                <input type="range" min={0} max={STROKE_MAX} value={layer.strokeWidth} onChange={(event) => updateText(layer.id, { strokeWidth: Number(event.target.value) })} />
                <strong>{layer.strokeWidth}</strong>
              </label>
              <div className="sticker-editor-row" role="radiogroup" aria-label={uiText('Положение надписи')}>
                {PLACES.map((place) => <button key={place.id} type="button" role="radio" aria-checked={layer.place === place.id} className={`button small${layer.place === place.id ? ' primary' : ''}`} onClick={() => updateText(layer.id, { place: place.id })}>{uiText(place.label)}</button>)}
                <button type="button" className="button small danger" onClick={() => removeText(layer.id)}><Trash2 size={15} />{uiText('Удалить')}</button>
              </div>
              <small className="sticker-editor-hint">{uiText('Надпись можно двигать пальцем')}</small>
            </div> : <small className="sticker-editor-hint">{uiText(texts.length ? 'Нажмите на надпись' : 'Добавьте надпись')}</small>}
          </div>}
        </>}
      </div>
      {step === 'edit' && <footer className="sticker-editor-foot">
        <button type="button" className="button ghost" onClick={onCancel} disabled={saving}>{uiText('Отмена')}</button>
        <button type="button" className="button primary" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{uiText(saving ? 'Сохраняем…' : 'Сохранить')}</button>
      </footer>}
    </section>
  </div>
}
