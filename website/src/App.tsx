import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { SiteLayout } from './components/SiteLayout'
import { CabinetPage } from './pages/CabinetPage'
import { DownloadPage } from './pages/DownloadPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReferralLandingPage } from './pages/ReferralLandingPage'
import { RegisterPage } from './pages/RegisterPage'

const TITLES: Record<string, string> = {
  '/': 'Tarkov Operations Companion',
  '/download': 'Скачать — Tarkov Operations Companion',
  '/login': 'Вход — Tarkov Operations Companion',
  '/register': 'Регистрация — Tarkov Operations Companion',
  '/cabinet': 'Личный кабинет — Tarkov Operations Companion',
}

export function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = TITLES[pathname] ?? 'Tarkov Operations Companion'
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={<HomePage />} />
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
