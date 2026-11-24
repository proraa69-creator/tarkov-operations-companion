import { useEffect, useState } from 'react'
import { Keyboard, X } from 'lucide-react'
import { SettingHelp } from '../components/SettingHelp'
import { uiText } from '../i18n/renderText'
import { screenApi, type ScreenTuningView } from './screenApi'
import { acceleratorOf } from './hotkey'

type KeyName = 'hotkey' | 'cycleKey'

const ROW_LABELS: Record<KeyName, string> = { hotkey: 'Клавиша вкл/выкл пресета экрана', cycleKey: 'Клавиша смены пресета экрана' }

const helpOf = (name: KeyName) => name === 'hotkey' ? 'presetToggle' : 'presetCycle'

const KEYS: Array<{ name: KeyName; label: string }> = [
  { name: 'hotkey', label: 'Вкл/выкл пресет' },
  { name: 'cycleKey', label: 'Сменить пресет' },
]

/**
 * The keys the player binds (owner, 28.10.2026: «не надо галочку ставить, просто… забиндить кнопку… изначально она будет
 * не назначена»; until then the button says «Назначьте клавишу»): one turns the chosen preset on and off from the game,
 * the other moves to the next preset. On «Настройка экрана» and in «Настройки».
 */
export function PresetTriggers({ view, onView, rows = false }: { view: ScreenTuningView | null; onView: (view: ScreenTuningView) => void; rows?: boolean }) {
  const api = screenApi()
  const [listening, setListening] = useState<KeyName | null>(null)
  // «Клавиша» or «Комбинация» per key (owner, 10.11.2026); unset: as the bound key is (with «+»: a combination).
  const [comboMode, setComboMode] = useState<Partial<Record<KeyName, boolean>>>({})
  const isCombo = (name: KeyName) => comboMode[name] ?? (view?.settings[name] ?? '').includes('+')
  const listeningCombo = listening ? isCombo(listening) : false

  // While a key is being picked: the next key pressed (Esc — cancel). A combination waits for Ctrl, Alt or Shift held
  // with a key; a single key leaves the held ones out. Mouse buttons cannot be one (a global shortcut is keys only).
  useEffect(() => {
    if (!listening || !api) return
    const pick = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape') { setListening(null); return }
      const plain = !listeningCombo
      if (!plain && !event.ctrlKey && !event.altKey && !event.shiftKey) return
      const accelerator = acceleratorOf(plain ? { code: event.code, ctrlKey: false, altKey: false, shiftKey: false } : event)
      if (!accelerator) return
      setListening(null)
      void api.update({ [listening]: accelerator }).then(onView)
    }
    window.addEventListener('keydown', pick, true)
    return () => window.removeEventListener('keydown', pick, true)
  }, [listening, listeningCombo, api, onView])

  if (!api || !view) return null
  // «Настройки» → «Клавиши»: the same two keys as rows beside the item keys (owner, 28.10.2026), labels only.
  if (rows) return <>{KEYS.map(({ name }) => {
    const key = view.settings[name]
    return (
      <div key={name} className="setting-row exp-hotkey">
        <span>
          <strong>{uiText(ROW_LABELS[name])}<SettingHelp id={helpOf(name)} /></strong>
          {listening === name && <small>{uiText(isCombo(name) ? 'Зажмите Ctrl, Shift или Alt и нажмите клавишу · Esc — отмена' : 'Нажмите клавишу… (Esc — отмена)')}</small>}
          {key && view.status.keysOk?.[name] === false && <small className="is-error">{uiText('Эта клавиша занята другой программой — выберите другую.')}</small>}
        </span>
        <span className="preset-key-actions">
          <span className="segmented-filter hotkey-mode" role="group" aria-label={uiText('Вид клавиши')}>
            <button type="button" className={isCombo(name) ? '' : 'active'} aria-pressed={!isCombo(name)} onClick={() => { setComboMode((modes) => ({ ...modes, [name]: false })); setListening(name) }}>{uiText('Клавиша')}</button>
            <button type="button" className={isCombo(name) ? 'active' : ''} aria-pressed={isCombo(name)} onClick={() => { setComboMode((modes) => ({ ...modes, [name]: true })); setListening(name) }}>{uiText('Комбинация')}</button>
          </span>
          {key && listening !== name && <button type="button" className="icon-button preset-key-clear" title={uiText('Убрать клавишу')} onClick={() => void api.update({ [name]: '' }).then(onView)}><X size={14} /></button>}
          <button type="button" className={`button ${listening === name ? 'primary' : 'ghost'} hotkey-button`} onClick={() => setListening(listening === name ? null : name)}>
            <kbd>{listening === name ? '…' : key || uiText('Назначьте клавишу')}</kbd>
          </button>
        </span>
      </div>
    )
  })}</>
  return (
    <div className="preset-keys">
      {KEYS.map(({ name, label }) => {
        const key = view.settings[name]
        return (
          <div key={name} className="preset-key">
            <Keyboard aria-hidden="true" />
            <span>{uiText(label)}<SettingHelp id={helpOf(name)} /></span>
            <button type="button" className={`button small${listening === name ? ' primary' : ''}`} onClick={() => setListening(listening === name ? null : name)}>
              {listening === name ? uiText('Нажмите клавишу… (Esc — отмена)') : key || uiText('Назначьте клавишу')}
            </button>
            {key && listening !== name && <button type="button" className="icon-button preset-key-clear" title={uiText('Убрать клавишу')} onClick={() => void api.update({ [name]: '' }).then(onView)}><X size={14} /></button>}
            {key && view.status.keysOk?.[name] === false && <small className="is-error">{uiText('Эта клавиша занята другой программой — выберите другую.')}</small>}
          </div>
        )
      })}
    </div>
  )
}
