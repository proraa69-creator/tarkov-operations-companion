import { Check } from 'lucide-react'
import { uiText } from '../i18n/renderText'

/**
 * «Сделал в этом рейде» at the end of a quest row in «Квесты на карте» (MapsPage): the player's own note for the
 * current raid (progression/questChecks.ts). It never completes the quest or changes its progress. A checked row moves
 * to the end of its list; React gives the focus back to this button after moving it.
 */
export function QuestRaidCheck({ questName, checked, onToggle }: { questName: string; checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="quest-raid-check"
      aria-pressed={checked}
      aria-label={`${uiText('Сделал в этом рейде')}: ${uiText(questName)}`}
      title={uiText(checked ? 'Снять галочку' : 'Сделал в этом рейде')}
      onClick={onToggle}
    >
      <Check size={16} strokeWidth={3} aria-hidden="true" />
    </button>
  )
}

/** Under the quest lists while any of them is checked: when the checks go, and a button to clear them now. */
export function QuestRaidChecksNote({ autoReset, onClear }: { autoReset: boolean; onClear: () => void }) {
  return (
    <div className="quest-raid-note">
      {/* Only the desktop app sees raids start (EFT logs); on the phone and in a browser the checks stay. */}
      <small>{uiText(autoReset ? 'Галочки сбрасываются при входе в следующий рейд' : 'Галочки остаются, пока вы их не снимете')}</small>
      <button type="button" className="button small ghost" onClick={onClear}>{uiText('Снять все галочки')}</button>
    </div>
  )
}
