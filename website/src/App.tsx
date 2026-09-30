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
import { StreamerInvitePage } from './pages/StreamerInvitePage'

const TITLES: Record<string, string> = {
  '/': 'Tarkov Operator',
  '/about': 'О нас — Tarkov Operator',
  '/download': 'Скачать — Tarkov Operator',
  '/login': 'Вход — Tarkov Operator',
  '/register': 'Регистрация — Tarkov Operator',
  '/cabinet': 'Личный кабинет — Tarkov Operator',
}

export function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = TITLES[pathname] ?? (pathname.startsWith('/streamer/') ? 'Приглашение стримера — Tarkov Operator' : 'Tarkov Operator')
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
        {/* Secret one-time streamer invitation; intentionally not linked from any menu. */}
        <Route path="streamer/:token" element={<StreamerInvitePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
