import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Keyboard, Swords } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { screenApi, type ScreenTuningView } from './screenApi'
import { acceleratorOf } from './hotkey'

/**
 * When the chosen preset goes on besides the switch (owner, 28.10.2026: «автоматически включать при входе в рейд… и
 * кнопка активация по клавише. Нажимаешь да, и у тебя появляется кнопка выбора»): by itself in a raid, and by a key the
 * player picks. On «Настройка экрана» and in «Настройки».
 */
export function PresetTriggers({ view, onView }: { view: ScreenTuningView | null; onView: (view: ScreenTuningView) => void }) {
  const api = screenApi()
  const en = useLocale().locale === 'en'
  const [listening, setListening] = useState(false)
  const settings = view?.settings
  const useKey = Boolean(settings?.hotkey) || listening

  const update = async (patch: Parameters<NonNullable<typeof api>['update']>[0]) => { if (api) onView(await api.update(patch)) }

  // While a key is being picked: the next key pressed (Esc — cancel).
  useEffect(() => {
    if (!listening) return
    const pick = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape') { setListening(false); return }
      const accelerator = acceleratorOf(event)
      if (!accelerator) return
      setListening(false)
      void update({ hotkey: accelerator })
    }
    window.addEventListener('keydown', pick, true)
    return () => window.removeEventListener('keydown', pick, true)
  })

  if (!api || !settings) return null
  return (
    <div className="preset-triggers">
      <label className="screen-switch">
        <input type="checkbox" checked={settings.autoRaid} onChange={(event) => void update({ autoRaid: event.target.checked })} />
        <Swords aria-hidden="true" />
        <span>{uiText('Включать пресет при входе в рейд')}</span>
      </label>
      <div className="preset-key">
        <label className="screen-switch">
          <input type="checkbox" checked={useKey} onChange={(event) => { if (event.target.checked) setListening(true); else { setListening(false); void update({ hotkey: '' }) } }} />
          <Keyboard aria-hidden="true" />
          <span>{uiText('Включать и выключать по клавише')}</span>
        </label>
        {useKey && (
          <button type="button" className={`button small${listening ? ' primary' : ''}`} onKeyDown={(event: ReactKeyboardEvent) => event.preventDefault()} onClick={() => setListening(true)}>
            {listening ? uiText('Нажмите клавишу… (Esc — отмена)') : settings.hotkey ? `${en ? 'Key' : 'Клавиша'}: ${settings.hotkey}` : uiText('Назначить клавишу')}
          </button>
        )}
        {settings.hotkey && view?.status.hotkeyOk === false && <small className="is-error">{uiText('Эта клавиша занята другой программой — выберите другую.')}</small>}
      </div>
    </div>
  )
}
