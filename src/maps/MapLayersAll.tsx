import { Eye, EyeOff } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { everythingHidden, hideAll, shownAgain, type LayerChoice, type ListedRows } from './layersAll'

/**
 * Report 181: «Показать все» / «Скрыть все» at the top of «Точки на карте» (maps/layersAll.ts says what they do). «Скрыть все»
 * keeps the player's choice and takes everything off the map; «Показать все» brings that choice back. A button with nothing
 * to do is dimmed.
 */
export function MapLayersAll({ listed, choice, kept, onApply }: {
  listed: ListedRows
  choice: LayerChoice
  /** The player's choice kept by «Скрыть все». */
  kept: LayerChoice | null
  onApply: (next: LayerChoice, kept: LayerChoice | null) => void
}) {
  return <div className="map-layers-all-box">
    <div className="map-layers-all">
      <button type="button" className="map-layers-all-button" disabled={!kept} onClick={() => { if (kept) onApply(shownAgain(kept, choice), null) }}>
        <Eye size={14} aria-hidden="true" /><span>{uiText('Показать все')}</span>
      </button>
      {/* pressed again after a row was turned on by hand: the choice kept the first time stays the one to come back */}
      <button type="button" className="map-layers-all-button" disabled={everythingHidden(listed, choice)} onClick={() => onApply(hideAll(choice), kept ?? choice)}>
        <EyeOff size={14} aria-hidden="true" /><span>{uiText('Скрыть все')}</span>
      </button>
    </div>
  </div>
}
