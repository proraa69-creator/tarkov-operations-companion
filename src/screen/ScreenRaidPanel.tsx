import { useEffect, useState } from 'react'
import { SunMedium } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { PresetTriggers } from './PresetTriggers'
import { screenApi, type ScreenTuningView } from './screenApi'
import './screenTuning.css'

/**
 * «Настройки» → the raid section: which preset of «Настройка экрана» goes on, by itself when a raid starts or by a key
 * (owner, 28.10.2026: «в настройках рейда добавь функцию, где пресеты… автоматически включать при входе в рейд»).
 * The PC app only.
 */
export function ScreenRaidPanel() {
  const api = screenApi()
  const [view, setView] = useState<ScreenTuningView | null>(null)
  useEffect(() => { if (api) void api.state().then(setView).catch(() => {}) }, [api])
  if (!api || !view) return null
  return (
    <section className="panel screen-raid-panel">
      <div className="panel-header">
        <h2><SunMedium aria-hidden="true" /> {uiText('Пресет экрана в рейде')}</h2>
        <Link to="/screen" className="button small ghost">{uiText('Настройка экрана')}</Link>
      </div>
      <div className="screen-raid-body">
        <label className="screen-monitor">
          <span>{uiText('Пресет')}</span>
          <select className="select" value={view.settings.activeId} onChange={(event) => void api.update({ activeId: event.target.value }).then(setView)}>
            {view.presets.map((preset) => <option key={preset.id} value={preset.id}>{uiText(preset.name)}</option>)}
          </select>
        </label>
        <PresetTriggers view={view} onView={setView} />
      </div>
    </section>
  )
}
