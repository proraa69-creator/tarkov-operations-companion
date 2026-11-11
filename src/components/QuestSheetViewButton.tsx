import { useEffect, useRef, useState } from 'react'
import { Check, Settings } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { QUEST_SHEET_VIEW_LABELS, QUEST_SHEET_VIEWS, setQuestSheetView, useQuestSheetView } from './questSheetView'

/** The gear on the top left of the quest window: its three looks (owner, 11.11.2026). Escape or a press outside closes the list. */
export function QuestSheetViewButton() {
  const view = useQuestSheetView()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return (
    <div ref={box} className="quest-sheet-view">
      <button type="button" className={`icon-button quest-sheet-view-button${open ? ' active' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={uiText('Вид окна')} title={uiText('Вид окна')} onClick={() => setOpen(!open)}>
        <Settings size={17} aria-hidden="true" />
      </button>
      {open && (
        <div className="quest-sheet-view-menu" role="menu" aria-label={uiText('Вид окна')}>
          {QUEST_SHEET_VIEWS.map((entry) => (
            <button key={entry} type="button" role="menuitemradio" aria-checked={view === entry} className={view === entry ? 'active' : undefined} onClick={() => { setQuestSheetView(entry); setOpen(false) }}>
              <span>{uiText(QUEST_SHEET_VIEW_LABELS[entry])}</span>
              {view === entry && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
