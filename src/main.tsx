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

// Players' app: tarkov.dev only through our server with a subscription; no plaintext game data left from older versions
// (docs/subscription-protection.md). Both are no-ops in the owner's app and in development.
installTarkovFetchGuard()
void purgeLegacyPlaintextCaches()
installLayoutAttributes()
applyAppearance()
clearRemovedAppearanceSettings()

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
const overlay = overlayKind(window.location.hash)

ReactDOM.createRoot(document.getElementById('root')!).render(
  overlay
    ? <LocaleProvider><OverlayApp kind={overlay} /></LocaleProvider>
    : <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider><AppStateProvider><DataProvider><HashRouter><App /></HashRouter></DataProvider></AppStateProvider></LocaleProvider>
      </QueryClientProvider>
    </React.StrictMode>,
)
