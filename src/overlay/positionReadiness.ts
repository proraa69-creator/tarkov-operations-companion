import { isPrintScreen } from './gameKeys.js'
import type { ScreenshotKeyInfo } from './screenshotCheck.js'

/**
 * Why the player's dot cannot appear on the minimap (owner, 13.10.2026: «сделай включение точки на миникарте проще…
 * что бы люди не настраивали 100 лет ее»). The position comes from the game's own screenshot, which the app asks for by
 * pressing the game's screenshot key when the minimap opens; each answer here is one thing that stops that, in the order
 * a player should fix them. Shared by the main process (a line in the minimap over the game) and the app's pages.
 */
export type PositionProblem = 'no-native' | 'no-key' | 'mouse-key' | 'snipping' | 'admin'

export interface PositionReadinessInput {
  /** The Windows functions (key state, key presses) loaded. */
  native: boolean
  key: Pick<ScreenshotKeyInfo, 'keys' | 'unbound' | 'sendable'>
  snipping: 'on' | 'off' | 'unknown'
  /** This app's administrator rights; null = unknown. */
  elevated: boolean | null
  /** Whether keys pressed in the game reach this app (hidden: the game runs elevated, this app does not). */
  gameKeys: 'visible' | 'hidden' | 'unknown'
}

export function positionProblem(input: PositionReadinessInput): PositionProblem | null {
  if (!input.native) return 'no-native'
  if (input.key.unbound) return 'no-key'
  if (!input.key.sendable) return 'mouse-key'
  if (isPrintScreen(input.key.keys) && input.snipping === 'on') return 'snipping'
  if (input.elevated === false && input.gameKeys === 'hidden') return 'admin'
  return null
}

/** What the app itself can fix with one click. */
export function positionFix(problem: PositionProblem | null): 'snipping' | 'admin' | null {
  return problem === 'snipping' || problem === 'admin' ? problem : null
}

/** The page's words for each problem: a short title and what happens / what to do. */
export const POSITION_PROBLEM_TEXT: Record<PositionProblem, { title: string; text: string; short: string }> = {
  'no-native': {
    title: 'Точка на мини-карте не работает',
    text: 'Не загрузился модуль Windows, который нажимает клавишу скриншота. Переустановите Raid OS.',
    short: 'нет позиции: не загрузился модуль Windows',
  },
  'no-key': {
    title: 'В игре не назначена клавиша скриншота',
    text: 'Позиция берётся из скриншота игры. Назначьте клавишу в игре: Настройки → Управление → «Скриншот» — приложение найдёт её само.',
    short: 'нет позиции: в игре не назначена клавиша скриншота',
  },
  'mouse-key': {
    title: 'Скриншот в игре назначен на кнопку мыши',
    text: 'Кнопку мыши приложение нажать не может. Назначьте в игре клавишу клавиатуры: Настройки → Управление → «Скриншот».',
    short: 'нет позиции: скриншот назначен на кнопку мыши',
  },
  snipping: {
    title: 'Windows забирает клавишу PrtSc',
    text: 'По PrtSc Windows открывает «Ножницы», игра эту клавишу не получает и не делает скриншот с координатами. Нажмите «Включить точку» — приложение выключит это в настройках Windows (вернуть можно там же).',
    short: 'нет позиции: PrtSc занят «Ножницами» — Raid OS → «Мини Карта» → «Включить точку»',
  },
  admin: {
    title: 'Игра запущена от имени администратора',
    text: 'Пока Raid OS работает без этих прав, Windows не пропускает в игру его нажатие клавиши скриншота. Перезапустите приложение от имени администратора.',
    short: 'нет позиции: перезапустите Raid OS от имени администратора',
  },
}
