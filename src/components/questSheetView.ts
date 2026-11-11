/**
 * How the quest window under the map looks (owner, 11.11.2026, of the four designs: «добавь 2 3 вариант и функцию смены вида,
 * кнопка в виде шестеренки слева вверху этого окна»): «Обычный» (the stages side by side, as before), «Вкладки» (one stage at a
 * time, its tab says how much of it is done) and «Шкала» (the stages as steps on one line, each objective a dot). Kept on this
 * device.
 */
import { useSyncExternalStore } from 'react'

export const QUEST_SHEET_VIEWS = ['classic', 'tabs', 'timeline'] as const
export type QuestSheetView = typeof QUEST_SHEET_VIEWS[number]
export const QUEST_SHEET_VIEW_LABELS: Record<QuestSheetView, string> = { classic: 'Обычный', tabs: 'Вкладки по этапам', timeline: 'Шкала этапов' }

const KEY = 'raidos-quest-sheet-view-v1'
const listeners = new Set<() => void>()

function read(): QuestSheetView {
  try {
    const saved = localStorage.getItem(KEY)
    return (QUEST_SHEET_VIEWS as readonly string[]).includes(saved ?? '') ? saved as QuestSheetView : 'classic'
  } catch {
    return 'classic'
  }
}

export function setQuestSheetView(view: QuestSheetView) {
  try {
    if (view === 'classic') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, view)
  } catch { /* the choice lasts until the window closes */ }
  current = view
  listeners.forEach((listener) => listener())
}

let current: QuestSheetView | null = null
const snapshot = () => (current ??= read())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useQuestSheetView(): QuestSheetView {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
