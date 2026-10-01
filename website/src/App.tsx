import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { SiteLayout } from './components/SiteLayout'
import { AboutPage } from './pages/AboutPage'
import { AdminPage } from './pages/AdminPage'
import { AppLoginPage } from './pages/AppLoginPage'
import { CabinetPage } from './pages/CabinetPage'
import { DownloadPage } from './pages/DownloadPage'
import { HomePage } from './pages/HomePage'
import { LegalPage } from './pages/LegalPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReferralLandingPage } from './pages/ReferralLandingPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { StreamerInvitePage } from './pages/StreamerInvitePage'
import { SquadLinkPage } from './pages/SquadLinkPage'

const TITLES: Record<string, string> = {
  '/': 'Raid OS',
  '/about': 'О нас — Raid OS',
  '/download': 'Скачать — Raid OS',
  '/login': 'Вход — Raid OS',
  '/register': 'Регистрация — Raid OS',
  '/reset': 'Восстановление пароля — Raid OS',
  '/cabinet': 'Личный кабинет — Raid OS',
  '/admin': 'Админ-панель — Raid OS',
  '/legal': 'Реквизиты и документы — Raid OS',
  '/legal/offer': 'Публичная оферта — Raid OS',
  '/legal/privacy': 'Политика обработки персональных данных — Raid OS',
  '/legal/consent': 'Согласие на обработку персональных данных — Raid OS',
  '/legal/cookies': 'Cookie и хранилище браузера — Raid OS',
}

export function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = TITLES[pathname] ?? (pathname.startsWith('/streamer/') ? 'Приглашение стримера — Raid OS' : pathname.startsWith('/squad/') ? 'Приглашение в отряд — Raid OS' : pathname.startsWith('/friend/') ? 'Приглашение в друзья — Raid OS' : 'Raid OS')
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="download" element={<DownloadPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="app-login" element={<AppLoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="reset" element={<ResetPasswordPage />} />
        <Route path="cabinet" element={<CabinetPage />} />
        {/* Owner only (the server checks every request); not linked from the menu. */}
        <Route path="admin" element={<AdminPage />} />
        <Route path="legal" element={<LegalPage />} />
        <Route path="legal/:slug" element={<LegalPage />} />
        <Route path="r/:code" element={<ReferralLandingPage />} />
        {/* Secret one-time streamer invitation; intentionally not linked from any menu. */}
        <Route path="streamer/:token" element={<StreamerInvitePage />} />
        {/* «Отряд» and friend invite links from the app (personal; not linked from any menu). */}
        <Route path="squad/:code" element={<SquadLinkPage kind="squad" />} />
        <Route path="friend/:code" element={<SquadLinkPage kind="friend" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
