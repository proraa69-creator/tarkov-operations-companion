import { useEffect, useRef, useState } from 'react'
import { Check, Settings } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { QUEST_SHEET_VIEW_LABELS, QUEST_SHEET_VIEWS, setQuestSheetView, useQuestSheetView } from './questSheetView'
import {
  PHONE_SHEET_HEIGHT_LABELS, PHONE_SHEET_HEIGHTS, PHONE_SHEET_VIEW_LABELS, PHONE_SHEET_VIEWS,
  setPhoneSheetHeight, setPhoneSheetView, usePhoneSheetHeight, usePhoneSheetView, usePortrait,
} from './phoneSheetView'

/**
 * The gear on the top left of the quest window: its looks (owner, 11.11.2026); `phone` lists the phone's own looks
 * (phoneSheetView.ts, 12.11.2026) and, held upright, the window's height. Escape or a press outside closes the list.
 */
export function QuestSheetViewButton({ phone = false }: { phone?: boolean }) {
  const view = useQuestSheetView()
  const phoneView = usePhoneSheetView()
  const height = usePhoneSheetHeight()
  const portrait = usePortrait()
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
  const entries = phone
    ? PHONE_SHEET_VIEWS.map((entry) => ({ id: entry, label: PHONE_SHEET_VIEW_LABELS[entry], active: phoneView === entry, pick: () => setPhoneSheetView(entry) }))
    : QUEST_SHEET_VIEWS.map((entry) => ({ id: entry, label: QUEST_SHEET_VIEW_LABELS[entry], active: view === entry, pick: () => setQuestSheetView(entry) }))
  const heights = phone && portrait
    ? PHONE_SHEET_HEIGHTS.map((entry) => ({ id: entry, label: PHONE_SHEET_HEIGHT_LABELS[entry], active: height === entry, pick: () => setPhoneSheetHeight(entry) }))
    : []
  const item = (entry: { id: string; label: string; active: boolean; pick: () => void }) => (
    <button key={entry.id} type="button" role="menuitemradio" aria-checked={entry.active} className={entry.active ? 'active' : undefined} onClick={() => { entry.pick(); setOpen(false) }}>
      <span>{uiText(entry.label)}</span>
      {entry.active && <Check size={13} aria-hidden="true" />}
    </button>
  )
  return (
    <div ref={box} className="quest-sheet-view">
      <button type="button" className={`icon-button quest-sheet-view-button${open ? ' active' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={uiText('Вид окна')} title={uiText('Вид окна')} onClick={() => setOpen(!open)}>
        <Settings size={17} aria-hidden="true" />
      </button>
      {open && (
        <div className="quest-sheet-view-menu" role="menu" aria-label={uiText('Вид окна')}>
          {phone && <div className="quest-sheet-view-heading">{uiText('Вид окна')}</div>}
          {entries.map(item)}
          {heights.length > 0 && <>
            <div className="quest-sheet-view-heading">{uiText('Высота окна')}</div>
            {heights.map(item)}
          </>}
        </div>
      )}
    </div>
  )
}
