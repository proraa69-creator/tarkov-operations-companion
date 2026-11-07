/* eslint-disable react-refresh/only-export-components -- the page's entry, never hot-reloaded */
import { StrictMode, useEffect, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './auth'
import './styles.css'
import { UiSounds } from './clickSound'
import { endStartupIntro, startupIntroShown } from '../../src/startup/startupIntro'
import { holdTrailer, openSite, settleUnderIntro } from './siteOpening'

/** The page is on screen: the emblem finishes its animation, flies to the header and the page puts itself together. */
function StartupIntroEnd() {
  // Before the first paint: drawn at rest behind the intro, it counts as on screen from now, not from when it opens.
  useLayoutEffect(() => { if (startupIntroShown()) settleUnderIntro() }, [])
  useEffect(() => {
    if (startupIntroShown()) holdTrailer()
    endStartupIntro(document, openSite)
  }, [])
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
