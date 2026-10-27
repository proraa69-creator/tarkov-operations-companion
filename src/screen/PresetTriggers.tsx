import { useEffect, useState } from 'react'
import { Keyboard, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { screenApi, type ScreenTuningView } from './screenApi'
import { acceleratorOf } from './hotkey'

type KeyName = 'hotkey' | 'cycleKey'

const KEYS: Array<{ name: KeyName; label: string }> = [
  { name: 'hotkey', label: 'Вкл/выкл пресет' },
  { name: 'cycleKey', label: 'Сменить пресет' },
]

/**
 * The keys the player binds (owner, 28.10.2026: «не надо галочку ставить, просто… забиндить кнопку… изначально она будет
 * не назначена»): one turns the chosen preset on and off from the game, the other moves to the next preset. On «Настройка
 * экрана» and in «Настройки».
 */
export function PresetTriggers({ view, onView }: { view: ScreenTuningView | null; onView: (view: ScreenTuningView) => void }) {
  const api = screenApi()
  const [listening, setListening] = useState<KeyName | null>(null)

  // While a key is being picked: the next key pressed (Esc — cancel).
  useEffect(() => {
    if (!listening || !api) return
    const pick = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape') { setListening(null); return }
      const accelerator = acceleratorOf(event)
      if (!accelerator) return
      setListening(null)
      void api.update({ [listening]: accelerator }).then(onView)
    }
    window.addEventListener('keydown', pick, true)
    return () => window.removeEventListener('keydown', pick, true)
  }, [listening, api, onView])

  if (!api || !view) return null
  return (
    <div className="preset-keys">
      {KEYS.map(({ name, label }) => {
        const key = view.settings[name]
        return (
          <div key={name} className="preset-key">
            <Keyboard aria-hidden="true" />
            <span>{uiText(label)}</span>
            <button type="button" className={`button small${listening === name ? ' primary' : ''}`} onClick={() => setListening(listening === name ? null : name)}>
              {listening === name ? uiText('Нажмите клавишу… (Esc — отмена)') : key || uiText('не назначена')}
            </button>
            {key && listening !== name && <button type="button" className="icon-button preset-key-clear" title={uiText('Убрать клавишу')} onClick={() => void api.update({ [name]: '' }).then(onView)}><X size={14} /></button>}
            {key && view.status.keysOk?.[name] === false && <small className="is-error">{uiText('Эта клавиша занята другой программой — выберите другую.')}</small>}
          </div>
        )
      })}
    </div>
  )
}
