import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isDesktopShell, useMobileLayout } from '../platform'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'
import { QUEST_SYNC_TIP_KEY, questSyncTipDue } from './guideProgress'
import { useOptionalAppState } from '../state/AppState'
import { useOptionalTarkovData } from '../data/DataProvider'
import { useLogStatus } from '../import/logStatus'
import { useLogsCoverModes } from '../import/logCoverage'

// owner, 14.10.2026: «при первом запуске следующего обновления на главном экране покажи всплывающее окно с указателем на
// блок справа квесты, и объясни, что для полной синхронизации нужно, чтобы данные квестов обновились… без лишних надписей»
const TIP: GuideTipContent = {
  title: { ru: 'Полная синхронизация квестов', en: 'Full quest sync' },
  text: () => ({
    ru: 'Чтобы Raid OS знал все ваши текущие квесты, их данные нужно один раз обновить. Не закрывая приложение, запустите игру, откройте «Персонаж» → «Задания» и не спеша пролистайте список до конца. Квесты появятся в этом блоке, а дальше будут обновляться сами. Играете в нескольких режимах (PvP, PvE) — сделайте это в каждом.',
    en: 'For Raid OS to know all your current quests, their data needs one update. Keep the app open, start the game, open Character → Tasks and slowly scroll the list to the end. The quests appear in this block and update by themselves after that. Playing several modes (PvP, PvE)? Do it in each one.',
  }),
  target: '[data-block="tasks"]',
}

// Storage unavailable: taken as seen, so the tip never comes back on every start.
const readSeen = () => { try { return localStorage.getItem(QUEST_SYNC_TIP_KEY) !== null } catch { return true } }

/**
 * After the update, once per computer: on the Overview of the PC app, a tip pointing at «Список текущих заданий» — how to
 * bring in all the current quests. Mounted once, next to the first-run guide; it waits for the startup notices too.
 * The Russian and the English game are both read (src/import/screenScanSync.ts), so the tip is in both languages.
 */
export function QuestSyncTip() {
  const { pathname } = useLocation()
  const phone = useMobileLayout()
  const [seen, setSeen] = useState(readSeen)
  // The logs of the mode shown hold every quest (src/import/logCoverage.ts): no need to open «Задания» and scroll.
  const appState = useOptionalAppState()
  const mode = appState?.raidMode
  const logsCover = useLogsCoverModes(useLogStatus().scan, useOptionalTarkovData()?.data.quests, appState?.activeProfile.modes)
  const due = questSyncTipDue({ desktop: isDesktopShell(), phone, pathname, seen, logsCover: mode ? logsCover[mode] : false })
  const ready = useGuideReady(due ? 'quest-sync' : null, pathname)
  if (!due || !ready) return null
  return <GuideTip id="quest-sync" tip={TIP} phone={false} onAccept={() => {
    try { localStorage.setItem(QUEST_SYNC_TIP_KEY, new Date().toISOString()) } catch { /* storage full: the tip may show once more */ }
    setSeen(true)
  }} />
}
