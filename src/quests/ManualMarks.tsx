import { Check, ListPlus, Undo2 } from 'lucide-react'
import type { ModeProgress, RaidMode } from '../domain/types'
import { useAppState } from '../state/AppState'
import { manualMarksText } from './manualMarksSetting'
import './manualMarks.css'

/**
 * «Ручная отметка» (owner, 15.10.2026: for a quest a bug got wrong): the card of a trader quest on the Quests page offers
 * «В текущие», «Выполнено» and «Снять отметку» (always since 03.11.2026: the page's switch made way for «Ручное
 * добавление», src/quests/ManualAdd.tsx). A mark is the player's own record of the mode (AppState.setManualQuestMark),
 * weighed against the logs by the quest-state engine (src/quests/questEngine.ts: it beats older log events, loses to
 * newer ones) and synced through the server. Story chapters get no marks.
 */

/** The small «вручную» tag of a quest decided by the player's mark (the list and the card). */
export function ManualTag({ progress, questId, locale }: { progress: ModeProgress; questId: string; locale: 'ru' | 'en' }) {
  if (progress.taskProgress[questId]?.source !== 'manual-fix') return null
  return <span className="tag manual-tag" title={manualMarksText(locale).tooltip}>{manualMarksText(locale).tag}</span>
}

/** «В текущие», «Выполнено» and «Снять отметку» of one trader quest in the mode shown. */
export function ManualMarkActions({ questId, mode, progress, locale, compact = false }: { questId: string; mode: RaidMode; progress: ModeProgress; locale: 'ru' | 'en'; compact?: boolean }) {
  const { setManualQuestMark } = useAppState()
  const text = manualMarksText(locale)
  const mark = progress.questInputs?.manual[questId]
  const marked = mark && (mark.status === 'active' || mark.status === 'completed') ? mark.status : null
  return <div className={`manual-mark-actions${compact ? ' is-compact' : ''}`} role="group" aria-label={text.toggle}>
    <button type="button" className={`button small ghost${marked === 'active' ? ' is-chosen' : ''}`} aria-pressed={marked === 'active'} onClick={() => setManualQuestMark(mode, questId, 'active')}><ListPlus size={12} aria-hidden="true" />{text.active}</button>
    <button type="button" className={`button small ghost${marked === 'completed' ? ' is-chosen' : ''}`} aria-pressed={marked === 'completed'} onClick={() => setManualQuestMark(mode, questId, 'completed')}><Check size={12} aria-hidden="true" />{text.completed}</button>
    {marked && <button type="button" className="button small ghost" onClick={() => setManualQuestMark(mode, questId, null)}><Undo2 size={12} aria-hidden="true" />{text.clear}</button>}
  </div>
}
