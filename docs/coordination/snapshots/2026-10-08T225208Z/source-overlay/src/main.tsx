// First: the desktop app's Content-Security-Policy is in place before any other module of the app runs.
import './app/contentSecurityPolicy'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './styles/global.css'
import './styles/pages.css'
import './styles/theme-gear.css'
import './styles/mobile.css'
import { App } from './app/App'
import { AppStateProvider } from './state/AppState'
import { DataProvider } from './data/DataProvider'
import { OverlayApp, overlayKind } from './overlay/OverlayApp'
import { LocaleProvider } from './i18n/LocaleProvider'
import { applyAppearance, clearRemovedAppearanceSettings } from './theme/theme'
import { installLayoutAttributes } from './platform'
import { installTarkovFetchGuard } from './data/tarkovApi'
import { purgeLegacyPlaintextCaches } from './data/gameDataCache'

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
    } catch {}
    location.reload()
  })
  root.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload())
}

window.addEventListener('error', (event) => showStartupError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => showStartupError(event.reason))

// Players' app: tarkov.dev only through our server with a subscription; no plaintext game data left from older versions
// (docs/subscription-protection.md). Both are no-ops in the owner's app and in development.
installTarkovFetchGuard()
void purgeLegacyPlaintextCaches()
installLayoutAttributes()
applyAppearance()
clearRemovedAppearanceSettings()

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
const overlay = overlayKind(window.location.hash)

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    overlay
      ? <LocaleProvider><OverlayApp kind={overlay} /></LocaleProvider>
      : <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <LocaleProvider><AppStateProvider><DataProvider><HashRouter><App /></HashRouter></DataProvider></AppStateProvider></LocaleProvider>
        </QueryClientProvider>
      </React.StrictMode>,
  )
} catch (error) {
  showStartupError(error)
}
