import type { ScreenshotKeyInfo } from './screenshotCheck.js'

/**
 * Why the player's dot cannot appear on «Карты» (owner, 13.10.2026: «сделай включение точки … проще… что бы люди не
 * настраивали 100 лет ее»). The position comes from the game's own screenshot: the app watches the screenshots folder
 * and reads the coordinates from each new file's name; the player takes the screenshot (owner, 14.10.2026), and the
 * words never say what the app does not do (owner, 15.10.2026). Since the in-game minimap went (owner, 15.10.2026) no
 * key of this app is involved: the only thing that stops the dot is a game without a «Скриншот» key. Shared by the
 * settings and «Обзор».
 */
export type PositionProblem = 'no-key'

export interface PositionReadinessInput {
  key: Pick<ScreenshotKeyInfo, 'keys' | 'unbound'>
}

export function positionProblem(input: PositionReadinessInput): PositionProblem | null {
  return input.key.unbound ? 'no-key' : null
}

/** The words for each problem: a short title and what to do. */
export const POSITION_PROBLEM_TEXT: Record<PositionProblem, { title: string; text: string }> = {
  'no-key': {
    title: 'В игре не назначена клавиша скриншота',
    text: 'Позиция берётся из скриншота, который делает игра. Назначьте в игре «Скриншот» (Настройки → Управление) на удобную клавишу: после каждого скриншота в рейде точка на «Картах» в приложении и в телефоне обновится.',
  },
}
