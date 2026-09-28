import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './styles/global.css'
import './styles/pages.css'
import { App } from './app/App'
import { AppStateProvider } from './state/AppState'
import { DataProvider } from './data/DataProvider'
import { OverlayApp, overlayKind } from './overlay/OverlayApp'
import { LocaleProvider } from './i18n/LocaleProvider'
import { applyAppearance } from './theme/theme'

applyAppearance()

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
