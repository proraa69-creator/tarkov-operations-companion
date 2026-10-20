import React from 'react'
import ReactDOM from 'react-dom/client'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AdminStandaloneApp } from './AdminStandaloneApp'
import { installNoPageZoom } from '../mobile/noPageZoom'
import './adminBase.css'

document.documentElement.setAttribute('data-layout', 'mobile')
// The owner's phone app: no page zoom on an accidental double tap or pinch either.
installNoPageZoom()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><LocaleProvider><AdminStandaloneApp /></LocaleProvider></React.StrictMode>,
)
