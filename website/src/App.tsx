import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { SiteLayout } from './components/SiteLayout'
import { AboutPage } from './pages/AboutPage'
import { AdminPage } from './pages/AdminPage'
import { AppLoginPage } from './pages/AppLoginPage'
import { BoostyPage } from './pages/BoostyPage'
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
import { tr, useSiteLocale } from './i18n'
import { updateSearchTags } from './searchTags'
import { TITLES } from './pageTitles'


export function App() {
  const { pathname } = useLocation()
  const locale = useSiteLocale()
  useEffect(() => {
    document.title = tr(TITLES[pathname] ?? (pathname.startsWith('/streamer/') ? 'Приглашение стримера — Raid OS' : pathname.startsWith('/squad/') ? 'Приглашение в отряд — Raid OS' : pathname.startsWith('/friend/') ? 'Приглашение в друзья — Raid OS' : 'Raid OS'))
    updateSearchTags(pathname)
  }, [pathname, locale])
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }, [pathname])

  // RU / EN: the whole site renders again in the chosen language (src/i18n/index.ts); the account session stays.
  return (
    <Routes key={locale}>
      <Route element={<SiteLayout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="download" element={<DownloadPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="app-login" element={<AppLoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="reset" element={<ResetPasswordPage />} />
        <Route path="cabinet" element={<CabinetPage />} />
        <Route path="boosty" element={<BoostyPage />} />
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
