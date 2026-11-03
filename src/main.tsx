// First: the desktop app's Content-Security-Policy is in place before any other module of the app runs.
import './app/contentSecurityPolicy'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { unstable_HistoryRouter as HistoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './styles/global.css'
import './styles/pages.css'
import './styles/theme-gear.css'
import './styles/theme-bloodmoon.css'
import './styles/mobile.css'
import { App } from './app/App'
import { createPageTransitionHistory, markViewTransitions } from './app/pageTransitionHistory'
import { AppStateProvider } from './state/AppState'
import { DataProvider } from './data/DataProvider'
import { LocaleProvider } from './i18n/LocaleProvider'
import { applyAppearance, clearRemovedAppearanceSettings } from './theme/theme'
import { installLayoutAttributes, isNative } from './platform'
import { installNoPageZoom } from './mobile/noPageZoom'
import { installTarkovFetchGuard } from './data/tarkovApi'
import { purgeLegacyPlaintextCaches } from './data/gameDataCache'
import { isBenignWindowError } from './app/windowErrors'

function showStartupError(error: unknown) {
  const root = document.getElementById('root')
  if (!root) return
  const message = error instanceof Error ? error.message : String(error ?? 'Неизвестная ошибка')
  root.innerHTML = `
    <div class="startup-recovery">
      <section class="startup-recovery-card">
        <div class="eyebrow">RAID OS</div>
        <h1>Приложение не смогло запуститься</h1>
        <p>Мы поймали ошибку вместо пустого экрана. Нажмите восстановление запуска: приложение очистит повреждённый интерфейсный кэш и перезагрузится.</p>
        <pre></pre>
        <div class="startup-recovery-actions">
          <button type="button" data-action="recover">Восстановить запуск</button>
          <button type="button" data-action="reload">Перезагрузить</button>
        </div>
      </section>
    </div>`
  root.querySelector('pre')!.textContent = message
  root.querySelector('[data-action="recover"]')?.addEventListener('click', () => {
    try {
      localStorage.removeItem('tarkov-operations-ui-v2')
      sessionStorage.clear()
    } catch { /* storage unavailable: reload anyway */ }
    location.reload()
  })
  root.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload())
}

/**
 * The recovery screen is for a start that failed: nothing of the app drawn yet. Once the app is on screen, a stray error
 * of a script or a promise never replaces it (React's errors go to the app's error boundary); it is only logged.
 */
function onWindowError(error: unknown) {
  if (isBenignWindowError(error)) return
  const root = document.getElementById('root')
  if (root && root.childElementCount > 0) {
    console.error('[raidos] uncaught error after start', error)
    return
  }
  showStartupError(error)
}

window.addEventListener('error', (event) => {
  if (isBenignWindowError(event.error ?? event.message)) { event.preventDefault(); return }
  onWindowError(event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => onWindowError(event.reason))

// Players' app: tarkov.dev only through our server with a subscription; no plaintext game data left from older versions
// (docs/subscription-protection.md). Both are no-ops in the owner's app and in development.
installTarkovFetchGuard()
void purgeLegacyPlaintextCaches()
installLayoutAttributes()
// Android / iPhone app: an accidental double tap or pinch never zooms the whole interface out of the screen.
if (isNative()) installNoPageZoom()
applyAppearance()
clearRemovedAppearanceSettings()

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
// Page changes crossfade (owner, 12.10.2026: «сделай нам так же плавно все приложение»).
const pageHistory = createPageTransitionHistory()
markViewTransitions()

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider><AppStateProvider><DataProvider><HistoryRouter history={pageHistory} useTransitions={false}><App /></HistoryRouter></DataProvider></AppStateProvider></LocaleProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  )
} catch (error) {
  showStartupError(error)
}
