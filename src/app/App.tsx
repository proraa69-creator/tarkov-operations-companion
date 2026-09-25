import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { DashboardPage } from '../pages/DashboardPage'
import { MapsPage } from '../pages/MapsPage'
import { QuestsPage } from '../pages/QuestsPage'
import { ItemsPage } from '../pages/ItemsPage'
import { HideoutPage, SettingsPage, TradersPage } from '../pages/ReferencePages'
import { FleaMarketPage } from '../pages/FleaMarketPage'
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
    <Route path="/flea" element={<FleaMarketPage />} />
    <Route path="/economy" element={<Navigate to="/flea" replace />} />
    <Route path="/keys" element={<Navigate to="/flea?tab=keys" replace />} />
    <Route path="/ammo" element={<Navigate to="/flea?tab=ammo" replace />} />
    <Route path="/hideout" element={<HideoutPage />} />
    <Route path="/traders" element={<TradersPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell>
}
