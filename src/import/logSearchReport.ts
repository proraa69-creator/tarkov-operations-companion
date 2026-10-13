import type { RaidMode } from '../domain/types'
import { uiLabel } from '../i18n/renderText'
import type { LogStatus } from './logStatus'

/**
 * Settings → «Журналы игры» (owner, 13.10.2026: a Steam player's logs were still not found — «человеку не помог наш
 * способ»): what the app read from the game's logs and every place it looked for them (electron/logDiscovery.ts
 * eftLogSearchReport), as text the player can copy and send to support. No game account numbers in it.
 */
export interface LogSearchReport {
  launcherGamesRoot?: string
  registeredGameFolders: string[]
  steamFolders: string[]
  steamLibraries: string[]
  drivesSearched: boolean
  folders: Array<{ folder: string; launches: number; newest?: string }>
}

const MODES: Array<[RaidMode, string]> = [['pvp', 'PvP'], ['pve', 'PvE'], ['seasonal', 'Сезон']]

/** One line per mode: whether the logs showed its game account, and how many quests. */
export function modeLines(status: LogStatus): string[] {
  return MODES.map(([mode, title]) => {
    const summary = status.scan?.summaryByMode[mode]
    const found = Boolean(status.scan?.latestAccountIdByMode[mode])
    const detail = found
      ? `${uiLabel('аккаунт найден')}, ${uiLabel('заданий')}: ${summary?.questCount ?? 0}`
      : uiLabel('нет в журналах')
    return `${uiLabel(title)}: ${detail}`
  })
}

export function logStatusText(status: LogStatus, nickname: string | undefined): string[] {
  return [
    `${uiLabel('Папка журналов')}: ${status.folder ?? uiLabel(status.notFound ? 'не найдена' : 'ещё ищем')}`,
    ...(status.scan ? [`${uiLabel('Прочитано запусков игры')}: ${status.scan.sessionCount}`, ...modeLines(status)] : []),
    `${uiLabel('Ник')}: ${nickname ?? uiLabel('не найден')}`,
  ]
}

export function logSearchReportText(report: LogSearchReport, version: string, status: LogStatus = {}, nickname?: string): string {
  const list = (values: string[], none: string) => (values.length ? values.join('; ') : uiLabel(none))
  return [
    `Raid OS ${version}`,
    ...logStatusText(status, nickname),
    `${uiLabel('Лаунчер BSG')}: ${report.launcherGamesRoot ?? uiLabel('не найден')}`,
    `${uiLabel('Игра в списке программ Windows')}: ${list(report.registeredGameFolders, 'нет записей')}`,
    `Steam: ${list(report.steamFolders, 'не найден')}`,
    `${uiLabel('Библиотеки Steam')}: ${list(report.steamLibraries, 'не найдены')}`,
    `${uiLabel('Поиск по дискам')}: ${uiLabel(report.drivesSearched ? 'выполнен' : 'не понадобился')}`,
    `${uiLabel('Найденные папки Logs')}:`,
    ...(report.folders.length
      ? report.folders.map(({ folder, launches, newest }) => `  ${folder} · ${uiLabel('запусков игры')}: ${launches}${newest ? ` · ${uiLabel('последний')}: ${newest}` : ''}`)
      : [`  ${uiLabel('ни одной')}`]),
  ].join('\n')
}
