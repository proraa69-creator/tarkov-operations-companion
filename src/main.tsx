import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import 'leaflet/dist/leaflet.css'
import './styles/global.css'
import './styles/pages.css'
import { App } from './app/App'
import { AppStateProvider } from './state/AppState'
import { DataProvider } from './data/DataProvider'

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'tarkov-operations-query-cache' })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}>
      <AppStateProvider><DataProvider><BrowserRouter><App /></BrowserRouter></DataProvider></AppStateProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
)
