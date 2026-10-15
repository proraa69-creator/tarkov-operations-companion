import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isDesktopShell, useMobileLayout } from '../platform'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'
import { acceptStep, GUIDE_CHANGED_EVENT, guideForAccount, QUEST_SYNC_TIP_KEY, questSyncTipDue, type GuideRecord } from './guideProgress'
import { useOptionalAppState } from '../state/AppState'
import { useOptionalTarkovData } from '../data/DataProvider'
import { useServerStatus } from '../sync/serverSync'
import { useLogStatus } from '../import/logStatus'
import { useLogsCoverModes } from '../import/logCoverage'

// owner, 14.10.2026: «при первом запуске следующего обновления на главном экране покажи всплывающее окно с указателем на
// блок справа квесты, и объясни, что для полной синхронизации нужно, чтобы данные квестов обновились… без лишних надписей»
const TARGET = '[data-block="tasks"]'
const TIP: GuideTipContent = {
  title: { ru: 'Полная синхронизация квестов', en: 'Full quest sync' },
  text: () => ({
    ru: 'Чтобы Raid OS знал все ваши текущие квесты, их данные нужно один раз обновить. Не закрывая приложение, запустите игру, откройте «Персонаж» → «Задания» и не спеша пролистайте список до конца. Квесты появятся в этом блоке, а дальше будут обновляться сами. Это нужно только в PvE.',
    en: 'For Raid OS to know all your current quests, their data needs one update. Keep the app open, start the game, open Character → Tasks and slowly scroll the list to the end. The quests appear in this block and update by themselves after that. Only PvE needs this.',
  }),
  target: TARGET,
}

// Storage unavailable: taken as seen, so the tip never comes back on every start.
const readOldSeen = () => { try { return localStorage.getItem(QUEST_SYNC_TIP_KEY) !== null } catch { return true } }

/**
 * Once per new account on this computer (owner, 15.10.2026: «это окно должно появляться только один раз при первичном
 * входе в аккаунт, после этого не должно быть снова»): on the Overview of the PC app, a tip pointing at «Список текущих
 * заданий» — how to bring in all the current quests. Part of the first-run guide: only an account with a guide record
 * (a new one, src/onboarding/guideProgress.ts) gets it, and «Принял» is kept in that record. Never over the loading
 * screen: it waits for the catalog and for the block it points at, and for the startup notices like the other tips.
 * The Russian and the English game are both read (src/import/screenScanSync.ts), so the tip is in both languages.
 */
export function QuestSyncTip() {
  const { pathname } = useLocation()
  const phone = useMobileLayout()
  const status = useServerStatus()
  const [guide, setGuide] = useState<{ email: string; record: GuideRecord } | null>(null)
  useEffect(() => {
    const read = () => setGuide(guideForAccount(status))
    read()
    window.addEventListener(GUIDE_CHANGED_EVENT, read)
    return () => window.removeEventListener(GUIDE_CHANGED_EVENT, read)
  }, [status])
  const [oldSeen] = useState(readOldSeen)
  const catalog = useOptionalTarkovData()
  // «Загружаем актуальную базу» is on screen while the first catalog loads (app/AppShell.tsx).
  const loading = catalog?.initialLoading ?? false
  // The logs of the mode shown hold every quest (src/import/logCoverage.ts): no need to open «Задания» and scroll.
  const appState = useOptionalAppState()
  const mode = appState?.raidMode
  const logsCover = useLogsCoverModes(useLogStatus().scan, catalog?.data.quests, appState?.activeProfile.modes)
  const seen = oldSeen || Boolean(guide?.record.accepted.includes('quest-sync'))
  const due = questSyncTipDue({ desktop: isDesktopShell(), phone, pathname, seen, newAccount: Boolean(guide), loading, logsCover: mode ? logsCover[mode] : false, mode })
  const ready = useGuideReady(due ? 'quest-sync' : null, pathname, TARGET)
  if (!due || !ready || !guide) return null
  return <GuideTip id="quest-sync" tip={TIP} phone={false} onAccept={() => acceptStep(guide.email, 'quest-sync')} />
}
