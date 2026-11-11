import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { GripHorizontal } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { FIXED_BLOCKS, type OverviewZoneId } from './overviewLayout'
import type { OverviewEditor } from './useOverviewEditor'

/**
 * One block of the Overview. In the editing mode a dashed frame with a grip covers it: the whole block is the handle,
 * the content underneath stays visible but does not react (inert), and a block that is empty right now (no squad) shows
 * a small placeholder so it can still be placed.
 */
export function OverviewBlock({ editor, zone, id, label, className, children }: {
  editor: OverviewEditor
  zone: OverviewZoneId
  id: string
  label: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { register } = editor
  useLayoutEffect(() => {
    register(id, ref.current)
    return () => register(id, null)
  }, [id, register])

  const movable = editor.editing && !FIXED_BLOCKS.has(id)
  const classes = ['overview-block', editor.editing && 'is-editing', editor.lifted === id && 'is-lifted', className].filter(Boolean).join(' ')
  return <div ref={ref} className={classes} data-block={id}>
    <div className="overview-block-content" inert={movable}>{children}</div>
    {movable && <div
      className="overview-veil"
      role="button"
      tabIndex={0}
      aria-roledescription={uiText('перемещаемый блок')}
      aria-label={`${uiText(label)}. ${uiText('Перетащите мышью или двигайте стрелками.')}`}
      title={uiText(label)}
      data-label={uiText(label)}
      data-empty={uiText('сейчас скрыт')}
      {...editor.handlers(zone, id)}
    >
      <span className="overview-grip" aria-hidden="true"><GripHorizontal size={14} /></span>
    </div>}
  </div>
}
