import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { DashboardPage } from '../pages/DashboardPage'
import { MapsPage } from '../pages/MapsPage'
import { QuestsPage } from '../pages/QuestsPage'
import { ItemsPage } from '../pages/ItemsPage'
import { AmmoPage, EconomyPage, HideoutPage, KeysPage, SettingsPage, TradersPage } from '../pages/ReferencePages'
import { ImportProgressPage } from '../pages/ImportProgressPage'
import { ProfilePage } from '../pages/ProfilePage'

export function App() {
  return <AppShell><Routes>
    <Route path="/" element={<DashboardPage />} />
    <Route path="/maps" element={<MapsPage />} />
    <Route path="/maps/:mapId" element={<MapsPage />} />
    <Route path="/quests" element={<QuestsPage />} />
    <Route path="/import" element={<ImportProgressPage />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/items" element={<ItemsPage />} />
    <Route path="/economy" element={<EconomyPage />} />
    <Route path="/keys" element={<KeysPage />} />
    <Route path="/ammo" element={<AmmoPage />} />
    <Route path="/hideout" element={<HideoutPage />} />
    <Route path="/traders" element={<TradersPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell>
}
