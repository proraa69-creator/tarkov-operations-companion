import { useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Columns2, MoveDiagonal2, RectangleHorizontal, RotateCcw } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { PHONE_NARROWABLE, type PhoneBlockSize } from './phoneLayout'
import type { PhoneOverview } from './usePhoneOverview'

/**
 * One block of the phone's Overview. While «Настроить блоки» is on, its content does not react (inert) and a bar on top
 * names it and moves it: ↑ / ↓, and for the two counters «узкий / во всю ширину».
 */
export function PhoneOverviewBlock({ overview, id, label, index, count, children }: {
  overview: PhoneOverview
  id: string
  label: string
  index: number
  count: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { register } = overview
  useLayoutEffect(() => {
    register(id, ref.current)
    return () => register(id, null)
  }, [id, register])

  const narrow = overview.layout.narrow.includes(id)
  const size = overview.layout.sizes?.[id]
  const width = size?.w ?? (narrow ? 0.5 : 1)
  const contentRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; left: number; top: number; gridWidth: number } | null>(null)

  // The corner handle (owner, 17.10.2026: «зажимает на угол блока и может перемещать вниз, вверх, влево, вправо, и от этого
  // меняется в реальном времени размер блока»): the width follows the finger as a share of the screen, the height in pixels.
  const begin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const content = contentRef.current
    const grid = ref.current?.parentElement
    if (!content || !grid) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const box = content.getBoundingClientRect()
    drag.current = { pointer: event.pointerId, left: ref.current!.getBoundingClientRect().left, top: box.top, gridWidth: grid.getBoundingClientRect().width }
  }
  const follow = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId || !start.gridWidth) return
    let w = (event.clientX - start.left) / start.gridWidth
    if (w > 0.96) w = 1
    else if (Math.abs(w - 0.5) < 0.025) w = 0.5
    const next: PhoneBlockSize = { h: event.clientY - start.top, ...(w < 1 ? { w } : {}) }
    overview.resize(id, next)
  }
  const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null
  }

  const classes = ['overview-block', 'phone-block', narrow && 'is-narrow', size && 'is-sized', size?.h !== undefined && 'has-height', width < 0.62 && 'is-small', overview.editing && 'is-editing'].filter(Boolean).join(' ')
  const style = { '--w': width, ...(size?.h !== undefined ? { '--h': `${size.h}px` } : {}) } as CSSProperties
  return <div ref={ref} className={classes} data-block={id} style={style}>
    <div ref={contentRef} className="overview-block-content" inert={overview.editing}>{children}</div>
    {overview.editing && <button type="button" className="phone-block-resize" aria-label={uiText('Изменить размер')} title={uiText('Изменить размер')}
      onPointerDown={begin} onPointerMove={follow} onPointerUp={end} onPointerCancel={end}><MoveDiagonal2 size={16} /></button>}
    {overview.editing && <div className="phone-block-tools" role="group" aria-label={uiText(label)}>
      <span className="phone-block-name">{uiText(label)}</span>
      {PHONE_NARROWABLE.has(id) && <button type="button" className="phone-block-tool" aria-pressed={narrow} onClick={() => overview.toggleNarrow(id)}
        aria-label={uiText(narrow ? 'Во всю ширину' : 'Узкий блок')} title={uiText(narrow ? 'Во всю ширину' : 'Узкий блок')}>
        {narrow ? <RectangleHorizontal size={15} /> : <Columns2 size={15} />}
      </button>}
      {size && <button type="button" className="phone-block-tool" onClick={() => overview.resize(id, undefined)} aria-label={uiText('Размер по умолчанию')} title={uiText('Размер по умолчанию')}><RotateCcw size={15} /></button>}
      <button type="button" className="phone-block-tool" disabled={index === 0} onClick={() => overview.move(id, -1)} aria-label={uiText('Выше')} title={uiText('Выше')}><ArrowUp size={15} /></button>
      <button type="button" className="phone-block-tool" disabled={index === count - 1} onClick={() => overview.move(id, 1)} aria-label={uiText('Ниже')} title={uiText('Ниже')}><ArrowDown size={15} /></button>
    </div>}
  </div>
}
