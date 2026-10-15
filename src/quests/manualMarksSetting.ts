import { useState } from 'react'

/** «Ручная отметка» on this device (src/quests/ManualMarks.tsx): off by default. */
export const MANUAL_MARKS_KEY = 'raidos-manual-marks-v1'

export function readManualMarksSetting() {
  try { return localStorage.getItem(MANUAL_MARKS_KEY) === '1' } catch { return false }
}

/** RU / EN texts of the manual marks. */
export function manualMarksText(locale: 'ru' | 'en') {
  return locale === 'en'
    ? { toggle: 'Manual marks', tooltip: 'If a quest did not appear or its status is wrong because of a bug, mark it by hand.', active: 'To current', completed: 'Completed', clear: 'Remove mark', tag: 'manual' }
    : { toggle: 'Ручная отметка', tooltip: 'Если квест не появился или статус неверный из-за ошибки — отметьте вручную.', active: 'В текущие', completed: 'Выполнено', clear: 'Снять отметку', tag: 'вручную' }
}

/** The setting and its switch: remembered on this device. */
export function useManualMarksSetting() {
  const [on, setOn] = useState(readManualMarksSetting)
  const change = (next: boolean) => {
    setOn(next)
    try { if (next) localStorage.setItem(MANUAL_MARKS_KEY, '1'); else localStorage.removeItem(MANUAL_MARKS_KEY) } catch { /* storage unavailable: this session only */ }
  }
  return [on, change] as const
}
