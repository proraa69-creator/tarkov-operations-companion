import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { featureEnabled } from './archivedFeatures'
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
import { QuestChecksRaidReset } from '../components/QuestChecksRaidReset'
import { UiSounds } from '../components/UiSounds'
import { RestockNotifier } from '../restock/RestockWidgets'
import { ExperimentalBridge } from '../components/ExperimentalBridge'
import { ExperimentalPage } from '../pages/ExperimentalPage'
import { KappaItemsPage } from '../pages/KappaItemsPage'
import { KeepItemsPage } from '../pages/KeepItemsPage'
import { RaidBriefingPage } from '../pages/RaidBriefingPage'
import { GalleryPage } from '../pages/GalleryPage'
import { SquadPage } from '../pages/SquadPage'
import { useLocale } from '../i18n/LocaleProvider'
import { LiveMapPage } from '../mobile/LiveMapPage'
import { isDesktopShell, useMobileLayout } from '../platform'
import { startAppActivity } from './appActivity'
import { useDataAccess } from '../account/dataAccess'
import { DeviceLimitNotice, Paywall } from '../account/Paywall'
import { EftAccountBinding } from '../account/EftAccountBinding'
import { UpdateButton } from '../components/UpdateButton'

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
  if (access.state === 'locked' || access.state === 'checking') return <><UiSounds /><div className="locked-update"><UpdateButton /></div><Paywall key={locale} access={access} /></>
  // Screen OCR and the overlay bridge exist only in the desktop shell; on the phone «Мини Карта» is the live map.
  return <AppErrorBoundary>{desktop && <><StoryScreenScanner /><QuestChecksRaidReset /><ExperimentalBridge /><EftAccountBinding /></>}<UiSounds /><RestockNotifier /><DeviceLimitNotice /><AppShell key={`${locale}:${revision}`}><Routes>
    <Route path="/experimental" element={mobile ? <Navigate to="/live" replace /> : <ExperimentalPage />} />
    <Route path="/live" element={<LiveMapPage />} />
    <Route path="/gallery" element={<GalleryPage />} />
    <Route path="/kappa-items" element={<KappaItemsPage />} />
    <Route path="/keep-items" element={featureEnabled('keepItems') ? <KeepItemsPage /> : <Navigate to="/kappa-items" replace />} />
    <Route path="/briefing" element={featureEnabled('raidBriefing') ? <RaidBriefingPage /> : <Navigate to="/" replace />} />
    <Route path="/" element={<DashboardPage />} />
    <Route path="/maps" element={<MapsPage />} />
    <Route path="/maps/:mapId" element={<MapsPage />} />
    <Route path="/quests" element={<QuestsPage />} />
    <Route path="/squad" element={<SquadPage />} />
    <Route path="/squad/:code" element={<SquadPage />} />
    <Route path="/friend/:code" element={<SquadPage friendLink />} />
    <Route path="/import" element={<Navigate to="/profile" replace />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/items" element={<Navigate to="/flea" replace />} />
    <Route path="/flea" element={<FleaMarketPage />} />
    <Route path="/economy" element={featureEnabled('economyTools') ? <EconomyPage /> : <Navigate to="/flea" replace />} />
    <Route path="/economy/barters" element={featureEnabled('economyTools') ? <BartersPage /> : <Navigate to="/flea" replace />} />
    <Route path="/economy/crafts" element={featureEnabled('economyTools') ? <CraftsPage /> : <Navigate to="/flea" replace />} />
    <Route path="/keys" element={<Navigate to="/flea?tab=keys" replace />} />
    <Route path="/ammo" element={<Navigate to="/ballistics" replace />} />
    <Route path="/ballistics" element={<AmmoPage />} />
    <Route path="/hideout" element={<Navigate to="/" replace />} />
    <Route path="/traders" element={<TradersPage />} />
    <Route path="/arsenal/builder" element={featureEnabled('gunBuilder') ? <Suspense fallback={null}><GunBuilderPage /></Suspense> : <Navigate to="/ballistics" replace />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell></AppErrorBoundary>
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error ?? 'Неизвестная ошибка') }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Raid OS render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="startup-recovery">
        <section className="startup-recovery-card">
          <div className="eyebrow">RAID OS</div>
          <h1>Интерфейс не смог открыться</h1>
          <p>Ошибка больше не оставляет пустой экран. Восстановление очистит только интерфейсный кэш, аккаунт и прогресс останутся на месте.</p>
          <pre>{this.state.error}</pre>
          <div className="startup-recovery-actions">
            <button type="button" onClick={() => {
              try {
                localStorage.removeItem('tarkov-operations-ui-v2')
                sessionStorage.clear()
              } catch {}
              location.reload()
            }}>Восстановить запуск</button>
            <button type="button" onClick={() => location.reload()}>Перезагрузить</button>
          </div>
        </section>
      </div>
    )
  }
}
