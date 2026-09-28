import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { SiteLayout } from './components/SiteLayout'
import { AboutPage } from './pages/AboutPage'
import { CabinetPage } from './pages/CabinetPage'
import { DownloadPage } from './pages/DownloadPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReferralLandingPage } from './pages/ReferralLandingPage'
import { RegisterPage } from './pages/RegisterPage'

const TITLES: Record<string, string> = {
  '/': 'Tarkov Operations Companion',
  '/about': 'О нас — Tarkov Operations Companion',
  '/download': 'Скачать — Tarkov Operations Companion',
  '/login': 'Вход — Tarkov Operations Companion',
  '/register': 'Регистрация — Tarkov Operations Companion',
  '/cabinet': 'Личный кабинет — Tarkov Operations Companion',
}

export function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = TITLES[pathname] ?? 'Tarkov Operations Companion'
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="download" element={<DownloadPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="cabinet" element={<CabinetPage />} />
        <Route path="r/:code" element={<ReferralLandingPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
