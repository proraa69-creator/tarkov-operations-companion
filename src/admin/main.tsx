import React from 'react'
import ReactDOM from 'react-dom/client'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { AdminStandaloneApp } from './AdminStandaloneApp'
import './adminBase.css'

document.documentElement.setAttribute('data-layout', 'mobile')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><LocaleProvider><AdminStandaloneApp /></LocaleProvider></React.StrictMode>,
)
