import { KeySquare } from 'lucide-react'
import { uiText } from '../i18n/renderText'

/**
 * «Нужные ключи» under the «Ключи» tab (report №112): on, the key points show only the keys missing from the stash that quests
 * open now or put aside need (maps/neededKeys.ts).
 */
export function NeededKeysButton({ count, on, onToggle }: { count: number; on: boolean; onToggle: () => void }) {
  return <button type="button" className={`layer-button ${on ? 'active' : ''}`} aria-pressed={on} onClick={onToggle}
    title={uiText('Только ключи, которых нет в схроне и которые нужны для текущих и отложенных квестов')}>
    <KeySquare size={16} color="#ffcf5a" aria-hidden="true" />
    <span>{uiText('Нужные ключи')}</span>
    <small>{uiText(count)}</small>
  </button>
}
