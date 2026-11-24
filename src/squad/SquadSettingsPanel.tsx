import { MapPin, PenLine, Settings2, UsersRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { uiText } from '../i18n/renderText'
import { setSquadSetting, useSquadSettings, type SquadSettings } from './squadSettings'

const ROWS: Array<{ key: keyof SquadSettings; icon: ReactNode; title: string; note: string }> = [
  { key: 'location', icon: <MapPin size={16} aria-hidden="true" />, title: 'Местоположение отряда', note: 'Скриншот в рейде — тиммейты видят вас на карте, вы их' },
  { key: 'sketches', icon: <PenLine size={16} aria-hidden="true" />, title: 'Зарисовки отряда', note: 'Рисунок на карте после ✓ видят тиммейты, вы их' },
  { key: 'quests', icon: <UsersRound size={16} aria-hidden="true" />, title: 'Квесты отряда', note: 'Кнопка «Квесты отряда» над картой' },
]

/** «Настройки отряда» on the «Отряд» page (squad/squadSettings.ts). */
export function SquadSettingsPanel() {
  const settings = useSquadSettings()
  return <section className="panel squad-settings">
    <div className="panel-header"><div className="panel-title">{uiText('Настройки отряда')}</div><Settings2 size={15} className="dim" /></div>
    <div className="panel-body squad-settings-list">
      {ROWS.map((row) => <label key={row.key} className="squad-setting">
        <span className="squad-setting-icon">{row.icon}</span>
        <span className="squad-setting-text"><strong>{uiText(row.title)}</strong><small className="muted">{uiText(row.note)}</small></span>
        <button type="button" role="switch" aria-checked={settings[row.key]} aria-label={uiText(row.title)} className={`toggle ${settings[row.key] ? 'on' : ''}`}
          onClick={() => setSquadSetting(row.key, !settings[row.key])}><span /></button>
      </label>)}
    </div>
  </section>
}
