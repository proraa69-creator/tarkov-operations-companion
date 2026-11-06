/* eslint-disable react-refresh/only-export-components -- the page's entry, never hot-reloaded */
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './auth'
import './styles.css'
import { UiSounds } from './clickSound'
import { endStartupIntro } from '../../src/startup/startupIntro'

/** The page is on screen: the emblem finishes its animation and the site opens. */
function StartupIntroEnd() {
  useEffect(() => { endStartupIntro() }, [])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiSounds />
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
    <StartupIntroEnd />
  </StrictMode>,
)
