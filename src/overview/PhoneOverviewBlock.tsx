import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Columns2, RectangleHorizontal } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { PHONE_NARROWABLE } from './phoneLayout'
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
  const classes = ['overview-block', 'phone-block', narrow && 'is-narrow', overview.editing && 'is-editing'].filter(Boolean).join(' ')
  return <div ref={ref} className={classes} data-block={id}>
    <div className="overview-block-content" inert={overview.editing}>{children}</div>
    {overview.editing && <div className="phone-block-tools" role="group" aria-label={uiText(label)}>
      <span className="phone-block-name">{uiText(label)}</span>
      {PHONE_NARROWABLE.has(id) && <button type="button" className="phone-block-tool" aria-pressed={narrow} onClick={() => overview.toggleNarrow(id)}
        aria-label={uiText(narrow ? 'Во всю ширину' : 'Узкий блок')} title={uiText(narrow ? 'Во всю ширину' : 'Узкий блок')}>
        {narrow ? <RectangleHorizontal size={15} /> : <Columns2 size={15} />}
      </button>}
      <button type="button" className="phone-block-tool" disabled={index === 0} onClick={() => overview.move(id, -1)} aria-label={uiText('Выше')} title={uiText('Выше')}><ArrowUp size={15} /></button>
      <button type="button" className="phone-block-tool" disabled={index === count - 1} onClick={() => overview.move(id, 1)} aria-label={uiText('Ниже')} title={uiText('Ниже')}><ArrowDown size={15} /></button>
    </div>}
  </div>
}
