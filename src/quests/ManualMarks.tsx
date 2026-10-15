import { Check, ListPlus, PencilLine, Undo2 } from 'lucide-react'
import type { ModeProgress, RaidMode } from '../domain/types'
import { useAppState } from '../state/AppState'
import { manualMarksText } from './manualMarksSetting'
import './manualMarks.css'

/**
 * «Ручная отметка» (owner, 15.10.2026: for a quest a bug got wrong). The toggle under «Капа: выполнено N из M» on the
 * Quests page: off by default, remembered on this device. While on, quest rows and the quest card offer «В текущие»,
 * «Выполнено» and «Снять отметку»; a mark is the player's own record of the mode (AppState.setManualQuestMark), weighed
 * against the logs by the quest-state engine (src/quests/questEngine.ts: it beats older log events, loses to newer ones)
 * and synced through the server. Story chapters get no marks.
 */
export function ManualMarksToggle({ on, onChange, locale }: { on: boolean; onChange: (on: boolean) => void; locale: 'ru' | 'en' }) {
  const text = manualMarksText(locale)
  return <button type="button" role="switch" aria-checked={on} className={`manual-marks-toggle${on ? ' is-on' : ''}`} title={text.tooltip} onClick={() => onChange(!on)}>
    <PencilLine size={12} aria-hidden="true" /><span>{text.toggle}</span><i aria-hidden="true" />
  </button>
}

/** The small «вручную» tag of a quest decided by the player's mark (shown whether the toggle is on or not). */
export function ManualTag({ progress, questId, locale }: { progress: ModeProgress; questId: string; locale: 'ru' | 'en' }) {
  if (progress.taskProgress[questId]?.source !== 'manual-fix') return null
  return <span className="tag manual-tag" title={manualMarksText(locale).tooltip}>{manualMarksText(locale).tag}</span>
}

/** «В текущие», «Выполнено» and «Снять отметку» of one trader quest in the mode shown. */
export function ManualMarkActions({ questId, mode, progress, locale, compact = false }: { questId: string; mode: RaidMode; progress: ModeProgress; locale: 'ru' | 'en'; compact?: boolean }) {
  const { setManualQuestMark } = useAppState()
  const text = manualMarksText(locale)
  const mark = progress.questInputs?.manual[questId]
  const marked = mark && mark.status !== 'cleared' ? mark.status : null
  return <div className={`manual-mark-actions${compact ? ' is-compact' : ''}`} role="group" aria-label={text.toggle}>
    <button type="button" className={`button small ghost${marked === 'active' ? ' is-chosen' : ''}`} aria-pressed={marked === 'active'} onClick={() => setManualQuestMark(mode, questId, 'active')}><ListPlus size={12} aria-hidden="true" />{text.active}</button>
    <button type="button" className={`button small ghost${marked === 'completed' ? ' is-chosen' : ''}`} aria-pressed={marked === 'completed'} onClick={() => setManualQuestMark(mode, questId, 'completed')}><Check size={12} aria-hidden="true" />{text.completed}</button>
    {marked && <button type="button" className="button small ghost" onClick={() => setManualQuestMark(mode, questId, null)}><Undo2 size={12} aria-hidden="true" />{text.clear}</button>}
  </div>
}
