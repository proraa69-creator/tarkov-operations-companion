import { useEffect, useState } from 'react'
import { PresetTriggers } from './PresetTriggers'
import { screenApi, type ScreenTuningView } from './screenApi'
import './screenTuning.css'

/**
 * «Настройки» → «Клавиши»: the two keys of «Настройка экрана» (on/off, next preset) as rows beside the item keys (owner,
 * 28.10.2026: «пресет экрана в рейде убери, должны быть только в настройках экрана… клавиши сюда добавь»). The PC app only.
 */
export function PresetKeyRows() {
  const api = screenApi()
  const [view, setView] = useState<ScreenTuningView | null>(null)
  useEffect(() => { if (api) void api.state().then(setView).catch(() => {}) }, [api])
  if (!api || !view) return null
  return <PresetTriggers view={view} onView={setView} rows />
}
