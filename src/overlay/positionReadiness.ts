import { screenshotOnKey } from './gameKeys.js'
import { HOTKEYS, hotkeyForGameKeys } from './hotkeys.js'
import type { ScreenshotKeyInfo } from './screenshotCheck.js'

/**
 * Why the player's dot cannot appear on the minimap (owner, 13.10.2026: «сделай включение точки на миникарте проще… что
 * бы люди не настраивали 100 лет ее»). The position comes from the game's own screenshot. The app presses no keys (owner,
 * 14.10.2026: «человек сам … нажимает клавишу. не программа»): the game's «Скриншот» goes on the same key as the minimap
 * («сделай что бы человек билдил кнопку в игре одну и туже куда он билдит миникарту в приложении»), so one press opens
 * the minimap and makes the game write the screenshot. Each answer here is one thing that stops that, in the order a
 * player should fix them. Shared by the main process (a line in the minimap over the game) and the app's pages.
 */
export type PositionProblem = 'no-native' | 'no-key' | 'other-key' | 'admin'

export interface PositionReadinessInput {
  /** The Windows functions (game window, key state) loaded. */
  native: boolean
  key: Pick<ScreenshotKeyInfo, 'keys' | 'unbound'>
  /** The app's minimap hotkey (KeyboardEvent.code, src/overlay/hotkeys.ts). */
  minimapKey: string
  /** This app's administrator rights; null = unknown. */
  elevated: boolean | null
  /** Whether keys pressed in the game reach this app (hidden: the game runs elevated, this app does not). */
  gameKeys: 'visible' | 'hidden' | 'unknown'
}

export function positionProblem(input: PositionReadinessInput): PositionProblem | null {
  if (!input.native) return 'no-native'
  if (input.key.unbound) return 'no-key'
  if (!screenshotOnKey(input.key.keys, HOTKEYS[input.minimapKey]?.vk)) return 'other-key'
  if (input.elevated === false && input.gameKeys === 'hidden') return 'admin'
  return null
}

/**
 * What the app itself can fix with one click: administrator rights, or — when the game's screenshot key is one the app
 * can watch and no other function of the app has it — making that key the minimap's (the binding in the game stays the
 * player's to change; the app never writes the game's files).
 */
export function positionFix(problem: PositionProblem | null, gameKeys: string[] = [], taken: Array<string | undefined> = []): 'use-game-key' | 'admin' | null {
  if (problem === 'admin') return 'admin'
  if (problem !== 'other-key') return null
  const code = hotkeyForGameKeys(gameKeys)
  return code && !taken.includes(code) ? 'use-game-key' : null
}

/** The page's words for each problem: a short title and what happens / what to do; `short` goes into the minimap. */
export const POSITION_PROBLEM_TEXT: Record<PositionProblem, { title: string; text: string; short: string }> = {
  'no-native': {
    title: 'Мини-карта не видит клавиши',
    text: 'Не загрузился модуль Windows, который видит нажатия клавиш в игре: мини-карта не откроется по клавише. Переустановите Raid OS.',
    short: 'мини-карта не видит клавиши: переустановите Raid OS',
  },
  'no-key': {
    title: 'В игре не назначена клавиша скриншота',
    text: 'Позиция берётся из скриншота, который делает игра. Назначьте в игре «Скриншот» (Настройки → Управление) на клавишу мини-карты — тогда одно нажатие откроет мини-карту и обновит точку.',
    short: 'нет позиции: в игре не назначен «Скриншот» — поставьте его на клавишу мини-карты',
  },
  'other-key': {
    title: 'Поставьте скриншот на клавишу мини-карты',
    text: 'Позиция берётся из скриншота, который делает игра по вашей клавише, — Raid OS сам ничего не нажимает. Назначьте в игре «Скриншот» (Настройки → Управление) на ту же клавишу, что открывает мини-карту: одно нажатие откроет мини-карту и обновит точку.',
    short: 'точка не обновится: в игре «Скриншот» не на клавише мини-карты',
  },
  admin: {
    title: 'Игра запущена от имени администратора',
    text: 'Пока Raid OS работает без этих прав, Windows скрывает от него клавиши, нажатые в игре, — мини-карта не откроется по клавише. Перезапустите приложение от имени администратора.',
    short: 'мини-карта не видит клавиши: перезапустите Raid OS от имени администратора',
  },
}
