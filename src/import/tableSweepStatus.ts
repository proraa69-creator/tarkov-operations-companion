import { useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import type { SweepRefusal } from './tableSweep'

/**
 * How a whole read of the Tasks table stands, for the Quests page (src/import/tableSweep.ts). Item 3 of the owner's request: what
 * is not proven removes nothing, and the player is told so in a line. Kept for this start of the app only.
 */
export type TableSweepStatus =
  | { kind: 'reading'; mode: RaidMode; read: number; total: number; unsettled: number; refusal?: SweepRefusal | 'mode' }
  | { kind: 'done'; mode: RaidMode; added: string[]; gone: string[] }

let current: TableSweepStatus | null = null
const listeners = new Set<() => void>()

export function setTableSweepStatus(next: TableSweepStatus | null) {
  if (JSON.stringify(next) === JSON.stringify(current)) return
  current = next
  for (const listener of listeners) listener()
}

export const tableSweepStatus = () => current

export function useTableSweepStatus() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, tableSweepStatus, () => null)
}

const NAMES_SHOWN = 5

function listed(names: string[], locale: 'ru' | 'en') {
  const shown = names.slice(0, NAMES_SHOWN).join(', ')
  const more = names.length - NAMES_SHOWN
  return more > 0 ? (locale === 'en' ? `${shown} and ${more} more` : `${shown} и ещё ${more}`) : shown
}

/** The line under «Найти квесты по экрану». `name`: a quest's title by its id. */
export function tableSweepLine(status: TableSweepStatus, locale: 'ru' | 'en', name: (id: string) => string) {
  const en = locale === 'en'
  if (status.kind === 'done') {
    const added = status.added.map(name)
    const gone = status.gone.map(name)
    const whole = en ? 'The whole list was read.' : 'Весь список прочитан.'
    const parts = [
      ...(added.length ? [en ? `Added: ${listed(added, locale)}.` : `Добавлено: ${listed(added, locale)}.`] : []),
      ...(gone.length ? [en ? `Gone: ${listed(gone, locale)}.` : `Убрано: ${listed(gone, locale)}.`] : []),
    ]
    return [whole, ...(parts.length ? parts : [en ? 'Your quests match the game.' : 'Квесты совпадают с игрой.'])].join(' ')
  }
  if (status.refusal === 'search') return en ? 'Something is typed in the table\'s «Search» field: clear it, the list is not whole. Nothing was removed.' : 'В поле «Поиск» таблицы что-то написано: очистите его, иначе виден не весь список. Ничего не убрано.'
  if (status.refusal === 'tab') return en ? 'Open the «Side» tab of «Tasks». Nothing was removed.' : 'Откройте вкладку «Побочные» в «Заданиях». Ничего не убрано.'
  if (status.refusal === 'view') return en ? 'This is not the list of your quests: open «Character» → «Tasks». Nothing was removed.' : 'Это не список ваших квестов: откройте «Персонаж» → «Задания». Ничего не убрано.'
  if (status.refusal === 'mode') return en ? 'The game shows another mode than its logs: read the list again later. Nothing was removed.' : 'Игра показывает другой режим, чем в её логах: прочитайте список позже. Ничего не убрано.'
  const read = en ? `Read ${status.read} of ${status.total} rows.` : `Прочитано строк: ${status.read} из ${status.total}.`
  const next = status.unsettled
    ? (en ? `${status.unsettled} not read exactly: scroll past them again, slowly.` : `Точно не прочитано: ${status.unsettled}. Пролистайте их ещё раз, медленно.`)
    : (en ? 'Scroll on, slowly, to both ends of the list.' : 'Листайте дальше, медленно, до обоих концов списка.')
  const held = en ? 'Until the whole list is read, nothing is removed.' : 'Пока весь список не прочитан, ничего не убирается.'
  return [read, next, held].join(' ')
}

/** The notice while the table is being read. */
export function tableScanNotice(until: string, locale: 'ru' | 'en') {
  const end = new Date(until).toLocaleString(locale === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return locale === 'en'
    ? `Reading the quests from the screen until ${end}. In the game open «Character» → «Tasks» → «Side» and slowly scroll the whole list from top to bottom: the app adds what is missing and removes what is not there. For story quests, open each chapter.`
    : `Чтение квестов с экрана включено до ${end}. Откройте в игре «Персонаж» → «Задания» → «Побочные» и медленно пролистайте весь список сверху донизу: приложение само добавит, чего не хватает, и уберёт, чего там нет. Сюжетные: откройте каждую главу.`
}
