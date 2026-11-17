import { Eye, EyeOff, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { uiText } from '../i18n/renderText'
import { everythingHidden, everythingShown, hideAll, sameChoice, showAll, type LayerChoice, type ListedRows } from './layersAll'

/**
 * Report 181: «Показать все» / «Скрыть все» at the top of «Точки на карте» (maps/layersAll.ts says what they switch). Right
 * after a press, the button just pressed turns into «Вернуть»: the player's own choice from before comes back. A button whose
 * work is already done, with nothing to bring back, is dimmed.
 */
export function MapLayersAll({ listed, choice, before, onApply }: {
  listed: ListedRows
  choice: LayerChoice
  /** The choice from before the last press. */
  before: LayerChoice | null
  onApply: (next: LayerChoice, before: LayerChoice | null) => void
}) {
  const shown = everythingShown(listed, choice)
  const hidden = everythingHidden(listed, choice)
  // only while the state is still what the press made: a row switched by hand since makes it the player's own again
  const bulk = sameChoice(choice, showAll(choice)) || sameChoice(choice, hideAll(choice))
  const back = before && bulk && !sameChoice(before, choice) ? before : null
  const button = (done: boolean, next: LayerChoice, icon: ReactNode, label: string) => {
    const undo = done && back
    return <button type="button" className={`map-layers-all-button${undo ? ' is-back' : ''}`} disabled={done && !back}
      title={undo ? uiText('Вернуть как было') : undefined}
      onClick={() => (undo ? onApply(back, null) : onApply(next, back ?? choice))}>
      <span key={undo ? 'back' : 'own'} className="map-layers-all-face">
        {undo ? <Undo2 size={14} aria-hidden="true" /> : icon}<span>{uiText(undo ? 'Вернуть' : label)}</span>
      </span>
    </button>
  }
  return <div className="map-layers-all-box">
    <div className="map-layers-all">
      {button(shown, showAll(choice), <Eye size={14} aria-hidden="true" />, 'Показать все')}
      {button(hidden, hideAll(choice), <EyeOff size={14} aria-hidden="true" />, 'Скрыть все')}
    </div>
  </div>
}
