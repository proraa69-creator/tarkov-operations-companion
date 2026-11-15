/* eslint-disable react-refresh/only-export-components */
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { uiText } from '../i18n/renderText'

/**
 * The PC's quest window over the map: a grip on its top edge sets the window's greatest height (owner, 15.11.2026: «на краю этого
 * блока сверху можно нажать на край, и эту шторку квеста можно выставить вверх или вниз… если следующий квест будет больше этого
 * окна, он становится не больше настроенной функции… если окна меньше, они складываются меньше»). A quest bigger than it scrolls
 * inside; a smaller one keeps the window as small as it is. Kept on this device; a double click gives back the usual height.
 */
const KEY = 'raidos-map-quest-sheet-max-v1'
export const SHEET_MIN = 120
const STEP = 24

export function readSheetMax(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY))
    return Number.isFinite(value) && value >= SHEET_MIN ? Math.round(value) : null
  } catch {
    return null
  }
}

function saveSheetMax(value: number | null) {
  try {
    if (value == null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(Math.round(value)))
  } catch { /* storage unavailable */ }
}

/** The height the window may reach between `SHEET_MIN` and what its map leaves (`room`). */
export const clampSheetMax = (value: number, room: number) => Math.round(Math.max(SHEET_MIN, Math.min(value, Math.max(SHEET_MIN, room))))

/** The greatest height (null: the usual one), whether it is being dragged, and the grip's handlers. */
export function useQuestSheetMax(sheetRef: RefObject<HTMLElement | null>) {
  const [max, setMax] = useState<number | null>(readSheetMax)
  const [sizing, setSizing] = useState(false)
  const drag = useRef<{ y: number; from: number; room: number } | null>(null)
  const room = () => {
    const sheet = sheetRef.current
    const stage = sheet?.parentElement
    // the window stands 12 px above the map's bottom: it may reach up to the map's top controls
    return stage ? stage.clientHeight - 72 : 600
  }
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const sheet = sheetRef.current
    if (!sheet || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { y: event.clientY, from: sheet.getBoundingClientRect().height, room: room() }
    setSizing(true)
    setMax(clampSheetMax(sheet.getBoundingClientRect().height, drag.current.room))
  }, [sheetRef]) // eslint-disable-line react-hooks/exhaustive-deps -- `room` reads the page as it is
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current
    if (!start) return
    setMax(clampSheetMax(start.from - (event.clientY - start.y), start.room))
  }, [])
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current
    if (!start) return
    drag.current = null
    setSizing(false)
    const value = clampSheetMax(start.from - (event.clientY - start.y), start.room)
    setMax(value)
    saveSheetMax(value)
  }, [])
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const from = max ?? sheetRef.current?.getBoundingClientRect().height ?? 340
    const value = clampSheetMax(from + (event.key === 'ArrowUp' ? STEP : -STEP), room())
    setMax(value)
    saveSheetMax(value)
  }, [max, sheetRef]) // eslint-disable-line react-hooks/exhaustive-deps -- `room` reads the page as it is
  const reset = useCallback(() => { setMax(null); saveSheetMax(null) }, [])
  return { max, sizing, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown, onDoubleClick: reset } }
}

/** The grip on the window's top edge. */
export function QuestSheetGrip({ max, handlers }: { max: number | null; handlers: ReturnType<typeof useQuestSheetMax>['handlers'] }) {
  const label = uiText('Высота окна')
  return (
    <div className="map-quest-sheet-grip" role="separator" aria-orientation="horizontal" aria-label={label} title={label}
      aria-valuemin={SHEET_MIN} {...(max != null ? { 'aria-valuenow': max } : {})} tabIndex={0} {...handlers}>
      <span aria-hidden="true" />
    </div>
  )
}
