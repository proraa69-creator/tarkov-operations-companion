import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { GripHorizontal, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { OverviewEditor } from './useOverviewEditor'

/**
 * One block of the PC Overview, at its place on the free grid (`style`). In the editing mode a dashed frame with a grip covers it:
 * the whole block is the handle, the content underneath stays visible but does not react (inert), and a block that is empty right
 * now (no squad) shows a small placeholder so it can still be placed.
 */
export function OverviewBlock({ editor, id, label, className, style, children }: {
  editor: OverviewEditor
  id: string
  label: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { register } = editor
  useLayoutEffect(() => {
    register(id, ref.current)
    return () => register(id, null)
  }, [id, register])

  const movable = editor.editing
  const classes = ['overview-block', editor.editing && 'is-editing', editor.lifted === id && 'is-lifted', className].filter(Boolean).join(' ')
  return <div ref={ref} className={classes} data-block={id} style={style}>
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
      {...editor.handlers(id)}
    >
      <span className="overview-grip" aria-hidden="true"><GripHorizontal size={14} /></span>
    </div>}
    {/* Off the Overview until «Сбросить» (owner, 17.11.2026). Not inside the veil: a press on it must not pick the block up. */}
    {movable && editor.lifted !== id && <button type="button" className="overview-remove" aria-label={`${uiText('Удалить блок')}: ${uiText(label)}`} title={uiText('Удалить блок')}
      onPointerDown={(event) => event.stopPropagation()} onClick={() => editor.remove(id)}><X size={13} aria-hidden="true" /></button>}
  </div>
}
