import { useSyncExternalStore } from 'react'
import { uiText } from '../i18n/renderText'
import { STYLES, STYLE_CHANGED_EVENT, currentStyle, saveStyle } from './theme'

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === 'tarkov-app-style') listener() }
  window.addEventListener(STYLE_CHANGED_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(STYLE_CHANGED_EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export const useAppStyle = () => useSyncExternalStore(subscribe, currentStyle, () => 'plain' as const)

/** «Обычный» / «Стекло»: the style of the shell, apart from the colour scheme (theme/theme.ts STYLES). */
export function StyleSwitch() {
  const style = useAppStyle()
  return <div className="style-switch" role="radiogroup" aria-label={uiText('Стиль')}>
    {STYLES.map((option) => <button key={option.id} type="button" role="radio" aria-checked={style === option.id} className={style === option.id ? 'active' : ''}
      onClick={(event) => { if (style !== option.id) saveStyle(option.id, event.currentTarget) }}>{uiText(option.label)}</button>)}
  </div>
}
