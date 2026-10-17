import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { featureEnabled } from './archivedFeatures'
import { isOwnerApp } from './buildEdition'
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
import { IdentityScreenReader } from '../components/IdentityScreenReader'
import { QuestChecksRaidReset } from '../components/QuestChecksRaidReset'
import { UiSounds } from '../components/UiSounds'
import { RestockNotifier } from '../restock/RestockWidgets'
import { ExperimentalBridge } from '../components/ExperimentalBridge'
import { KappaItemsPage } from '../pages/KappaItemsPage'
import { KeepItemsPage } from '../pages/KeepItemsPage'
import { RaidBriefingPage } from '../pages/RaidBriefingPage'
import { GalleryPage } from '../pages/GalleryPage'
import { SquadPage } from '../pages/SquadPage'
import { RequestsPage } from '../pages/RequestsPage'
import { useLocale } from '../i18n/LocaleProvider'
import { PhoneMapsPage } from '../mobile/PhoneMapsPage'
import { isDesktopShell, useMobileLayout } from '../platform'
import { startAppActivity } from './appActivity'
import { useDataAccess } from '../account/dataAccess'
import { DeviceLimitNotice, Paywall } from '../account/Paywall'
import { EftAccountBinding } from '../account/EftAccountBinding'
import { UpdateButton } from '../components/UpdateButton'
import { AdminMobilePage } from '../admin/AdminMobilePage'
import { FirstRunGuide } from '../onboarding/FirstRunGuide'
import { QuestSyncTip } from '../onboarding/QuestSyncTip'
import { RaidLoadoutTip } from '../onboarding/RaidLoadoutTip'
import { GoonsRestTip } from '../onboarding/GoonsRestTip'
import { ScourgeEventIntro } from '../events/ScourgeEventIntro'
import { GameRestartNotice } from '../onboarding/GameRestartNotice'
import { AnnouncementBanner } from '../announcement/AnnouncementBanner'
import { AccountNotices, AfterNotices } from '../notices/AccountNotices'

// The builder (and its large mod catalogue) loads only when «Арсенал → Сборщик оружия» is opened.
const BossTacticsPage = lazy(() => import('../pages/BossTacticsPage').then((module) => ({ default: module.BossTacticsPage })))
const HideoutStashPage = lazy(() => import('../pages/HideoutStashPage').then((module) => ({ default: module.HideoutStashPage })))
const WeaponBuildsPage = lazy(() => import('../pages/WeaponBuildsPage').then((module) => ({ default: module.WeaponBuildsPage })))
// «Оружейник → Посмотреть все»: loads the weapon builder's part data only when opened.
const GunsmithPage = lazy(() => import('../pages/GunsmithPage').then((module) => ({ default: module.GunsmithPage })))
// «Админ панель» (owner app only): the owner's tools load only when it is opened.
const AdminPanelPage = lazy(() => import('../pages/AdminPanelPage').then((module) => ({ default: module.AdminPanelPage })))

export function App() {
  const { locale, revision } = useLocale()
  const mobile = useMobileLayout()
  const desktop = isDesktopShell()
  const access = useDataAccess()
  // Decorative motion sleeps while the window is not in use (the player is in the game), see appActivity.ts.
  useEffect(() => startAppActivity(), [])
  // Players' app without a valid entitlement: only the account and subscription screens (docs/subscription-protection.md).
  // The game started before the sign-in still gives the nickname and levels: its start screens are read and kept until
  // the app unlocks (audit P4a, #202), nothing else.
  // «Укажите страну» and the owner's notices and surveys (src/notices/AccountNotices.tsx): over the locked screens too.
  if (access.state === 'locked' || access.state === 'checking') return <><UiSounds /><AccountNotices /><AnnouncementBanner placement="page" />{desktop && <IdentityScreenReader />}<div className="locked-update"><UpdateButton /></div><Paywall key={locale} access={access} /></>
  // Screen OCR and the item lookup's bridge exist only in the desktop shell; on the phone «Карты» show the player's position.
  return <AppErrorBoundary>{desktop && <><StoryScreenScanner /><QuestChecksRaidReset /><ExperimentalBridge /><EftAccountBinding /><GameRestartNotice /></>}<UiSounds /><AccountNotices /><RestockNotifier /><DeviceLimitNotice /><AfterNotices><FirstRunGuide /><QuestSyncTip /><RaidLoadoutTip /><GoonsRestTip /><ScourgeEventIntro /></AfterNotices><AppShell key={`${locale}:${revision}`}><Routes>
    {/* The «Мини Карта» page of the in-game overlays went (owner, 15.10.2026); its settings are in «Настройки». */}
    <Route path="/experimental" element={<Navigate to={mobile ? '/maps' : '/settings'} replace />} />
    {/* The phone's former «Мини Карта» (owner, 13.10.2026): the position is on «Карты» now. */}
    <Route path="/live" element={<Navigate to="/maps" replace />} />
    <Route path="/gallery" element={<GalleryPage />} />
    {/* «Тактика боя»: not in the menu, opened only from a boss's button (Gallery, the raid card). */}
    <Route path="/bosses/:key/tactics" element={<Suspense fallback={null}><BossTacticsPage /></Suspense>} />
    <Route path="/kappa-items" element={<KappaItemsPage />} />
    <Route path="/keep-items" element={featureEnabled('keepItems') ? <KeepItemsPage /> : <Navigate to="/kappa-items" replace />} />
    <Route path="/briefing" element={featureEnabled('raidBriefing') ? <RaidBriefingPage /> : <Navigate to="/" replace />} />
    <Route path="/" element={<DashboardPage />} />
    <Route path="/maps" element={mobile ? <PhoneMapsPage /> : <MapsPage />} />
    <Route path="/maps/:mapId" element={mobile ? <PhoneMapsPage /> : <MapsPage />} />
    <Route path="/quests" element={<QuestsPage />} />
    {/* «Оружейник»: not in the menu, opened from the Overview block («Посмотреть все»). */}
    <Route path="/gunsmith" element={<Suspense fallback={null}><GunsmithPage /></Suspense>} />
    <Route path="/squad" element={<SquadPage />} />
    <Route path="/squad/:code" element={<SquadPage />} />
    <Route path="/friend/:code" element={<SquadPage friendLink />} />
    <Route path="/requests" element={<RequestsPage />} />
    <Route path="/admin" element={isOwnerApp() ? <Suspense fallback={null}><AdminPanelPage /></Suspense> : <Navigate to="/" replace />} />
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
    <Route path="/hideout" element={featureEnabled('hideoutStash') || import.meta.env.DEV ? <Suspense fallback={null}><HideoutStashPage /></Suspense> : <Navigate to="/" replace />} />
    <Route path="/traders" element={<TradersPage />} />
    {/* The old «Сборщик оружия» became «Сборка оружия» (owner, 17.10.2026). */}
    <Route path="/arsenal/builder" element={<Navigate to="/arsenal/builds" replace />} />
    {/* «Сборка оружия»: shown to the owner before it goes in the menu (src/app/archivedFeatures.ts weaponBuilds). */}
    <Route path="/arsenal/builds" element={featureEnabled('weaponBuilds') || import.meta.env.DEV ? <Suspense fallback={null}><WeaponBuildsPage /></Suspense> : <Navigate to="/ballistics" replace />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/admin" element={<AdminMobilePage />} />
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
              } catch { /* storage unavailable: reload all the same */ }
              location.reload()
            }}>Восстановить запуск</button>
            <button type="button" onClick={() => location.reload()}>Перезагрузить</button>
          </div>
        </section>
      </div>
    )
  }
}
