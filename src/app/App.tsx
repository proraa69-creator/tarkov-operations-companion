import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { DashboardPage } from '../pages/DashboardPage'
import { MapsPage } from '../pages/MapsPage'
import { QuestsPage } from '../pages/QuestsPage'
import { SettingsPage, TradersPage } from '../pages/ReferencePages'
import { FleaMarketPage } from '../pages/FleaMarketPage'
import { ProfilePage } from '../pages/ProfilePage'
import { StoryScreenScanner } from '../components/StoryScreenScanner'
import { UiSounds } from '../components/UiSounds'
import { ExperimentalBridge } from '../components/ExperimentalBridge'
import { ExperimentalPage } from '../pages/ExperimentalPage'
import { useLocale } from '../i18n/LocaleProvider'
import { lazy, Suspense } from 'react'

// Test edition only: the build-time flag folds to `false` in the main build, so this import is not bundled.
const HandControlLayer = __RAIDOS_HAND_CONTROL__ ? lazy(() => import('../handControl/HandControlLayer').then((module) => ({ default: module.HandControlLayer }))) : null

export function App() {
  const { locale, revision } = useLocale()
  return <><StoryScreenScanner /><UiSounds /><ExperimentalBridge />{HandControlLayer ? <Suspense fallback={null}><HandControlLayer /></Suspense> : null}<AppShell key={`${locale}:${revision}`}><Routes>
    <Route path="/experimental" element={<ExperimentalPage />} />
    <Route path="/" element={<DashboardPage />} />
    <Route path="/maps" element={<MapsPage />} />
    <Route path="/maps/:mapId" element={<MapsPage />} />
    <Route path="/quests" element={<QuestsPage />} />
    <Route path="/import" element={<Navigate to="/profile" replace />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/items" element={<Navigate to="/flea" replace />} />
    <Route path="/flea" element={<FleaMarketPage />} />
    <Route path="/economy" element={<Navigate to="/flea" replace />} />
    <Route path="/keys" element={<Navigate to="/flea?tab=keys" replace />} />
    <Route path="/ammo" element={<Navigate to="/flea?tab=ammo" replace />} />
    <Route path="/hideout" element={<Navigate to="/" replace />} />
    <Route path="/traders" element={<TradersPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell></>
}
