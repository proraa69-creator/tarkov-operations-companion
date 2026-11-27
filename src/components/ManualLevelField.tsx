import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { MAX_PLAYER_LEVEL } from '../import/modeSelectScreen'

/**
 * «Указать уровень» (owner, 27.11.2026: «ручной ввод уровня»): the player's own level of the shown mode, 1–79, while no
 * reading of the game or Tarkov.dev has it (src/domain/progress.ts setManualLevel). A newer reading replaces it by itself.
 */
export function ManualLevelField({ onSave }: { onSave: (level: number) => void }) {
  const [value, setValue] = useState('')
  const typed = value.trim()
  const level = /^\d{1,2}$/.test(typed) ? Number(typed) : 0
  const valid = level >= 1 && level <= MAX_PLAYER_LEVEL
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    onSave(level)
    setValue('')
  }
  return (
    <form className="manual-level" onSubmit={save}>
      <label>
        <span>{uiLabel('Указать уровень')}</span>
        <input className="input" type="number" inputMode="numeric" min={1} max={MAX_PLAYER_LEVEL} step={1} placeholder={`1–${MAX_PLAYER_LEVEL}`} value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="submit" className="button small primary" disabled={!valid}><Check size={13} aria-hidden="true" />{uiLabel('Сохранить')}</button>
    </form>
  )
}
