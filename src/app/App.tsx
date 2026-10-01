import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { DashboardPage } from '../pages/DashboardPage'
import { MapsPage } from '../pages/MapsPage'
import { QuestsPage } from '../pages/QuestsPage'
import { AmmoPage, EconomyPage, SettingsPage, TradersPage } from '../pages/ReferencePages'
import { BartersPage } from '../pages/BartersPage'
import { CraftsPage } from '../pages/CraftsPage'
import { FleaMarketPage } from '../pages/FleaMarketPage'
import { ProfilePage } from '../pages/ProfilePage'
import { StoryScreenScanner } from '../components/StoryScreenScanner'
import { UiSounds } from '../components/UiSounds'
import { RestockNotifier } from '../restock/RestockWidgets'
import { ExperimentalBridge } from '../components/ExperimentalBridge'
import { ExperimentalPage } from '../pages/ExperimentalPage'
import { KappaItemsPage } from '../pages/KappaItemsPage'
import { KeepItemsPage } from '../pages/KeepItemsPage'
import { RaidBriefingPage } from '../pages/RaidBriefingPage'
import { GalleryPage } from '../pages/GalleryPage'
import { useLocale } from '../i18n/LocaleProvider'
import { LiveMapPage } from '../mobile/LiveMapPage'
import { isDesktopShell, useMobileLayout } from '../platform'
import { startAppActivity } from './appActivity'
import { useDataAccess } from '../account/dataAccess'
import { DeviceLimitNotice, Paywall } from '../account/Paywall'

// The builder (and its large mod catalogue) loads only when «Арсенал → Сборщик оружия» is opened.
const GunBuilderPage = lazy(() => import('../pages/GunBuilderPage').then((module) => ({ default: module.GunBuilderPage })))

export function App() {
  const { locale, revision } = useLocale()
  const mobile = useMobileLayout()
  const desktop = isDesktopShell()
  const access = useDataAccess()
  // Decorative motion sleeps while the window is not in use (the player is in the game), see appActivity.ts.
  useEffect(() => startAppActivity(), [])
  // Players' app without a valid entitlement: only the account and subscription screens (docs/subscription-protection.md).
  if (access.state === 'locked' || access.state === 'checking') return <><UiSounds /><Paywall key={locale} access={access} /></>
  // Screen OCR and the overlay bridge exist only in the desktop shell; on the phone «Мини Карта» is the live map.
  return <>{desktop && <><StoryScreenScanner /><ExperimentalBridge /></>}<UiSounds /><RestockNotifier /><DeviceLimitNotice /><AppShell key={`${locale}:${revision}`}><Routes>
    <Route path="/experimental" element={mobile ? <Navigate to="/live" replace /> : <ExperimentalPage />} />
    <Route path="/live" element={<LiveMapPage />} />
    <Route path="/gallery" element={<GalleryPage />} />
    <Route path="/kappa-items" element={<KappaItemsPage />} />
    <Route path="/keep-items" element={<KeepItemsPage />} />
    <Route path="/briefing" element={<RaidBriefingPage />} />
    <Route path="/" element={<DashboardPage />} />
    <Route path="/maps" element={<MapsPage />} />
    <Route path="/maps/:mapId" element={<MapsPage />} />
    <Route path="/quests" element={<QuestsPage />} />
    <Route path="/import" element={<Navigate to="/profile" replace />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/items" element={<Navigate to="/flea" replace />} />
    <Route path="/flea" element={<FleaMarketPage />} />
    <Route path="/economy" element={<EconomyPage />} />
    <Route path="/economy/barters" element={<BartersPage />} />
    <Route path="/economy/crafts" element={<CraftsPage />} />
    <Route path="/keys" element={<Navigate to="/flea?tab=keys" replace />} />
    <Route path="/ammo" element={<Navigate to="/ballistics" replace />} />
    <Route path="/ballistics" element={<AmmoPage />} />
    <Route path="/hideout" element={<Navigate to="/" replace />} />
    <Route path="/traders" element={<TradersPage />} />
    <Route path="/arsenal/builder" element={<Suspense fallback={null}><GunBuilderPage /></Suspense>} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell></>
}
