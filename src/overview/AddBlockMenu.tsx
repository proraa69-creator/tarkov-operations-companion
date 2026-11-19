import { useEffect, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'

/**
 * «Добавить блок» in «Настроить блоки» on the PC (owner, 20.11.2026: «добавь функцию добавить блоки, то есть туда можно что-либо
 * добавить, если есть выбор»): the blocks not on the Overview now — taken off with the cross, later the new ones — in a menu under
 * the button. Shown only while there is something to add. Esc and a press elsewhere close the menu (Esc does not end the editing).
 */
export function AddBlockMenu({ choices, onAdd }: { choices: Array<{ id: string; label: string }>; onAdd: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true) }
  }, [open])
  if (!choices.length) return null
  return <div ref={box} className="overview-add">
    <button type="button" className={`button${open ? ' primary' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}>
      <Plus size={16} />{uiText(' Добавить блок')}
    </button>
    {open && <div id={menuId} className="overview-add-menu" role="menu" aria-label={uiLabel('Добавить блок')}>
      {choices.map((choice) => <button key={choice.id} type="button" role="menuitem" className="overview-add-item" onClick={() => { setOpen(false); onAdd(choice.id) }}>
        <Plus size={14} aria-hidden="true" /><span>{uiText(choice.label)}</span>
      </button>)}
    </div>}
  </div>
}
