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

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppStateProvider><DataProvider><HashRouter><App /></HashRouter></DataProvider></AppStateProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
