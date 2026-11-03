/** RU / EN texts of the manual marks (src/quests/ManualMarks.tsx). */
export function manualMarksText(locale: 'ru' | 'en') {
  return locale === 'en'
    ? { toggle: 'Manual marks', tooltip: 'If a quest did not appear or its status is wrong because of a bug, mark it by hand.', active: 'To current', completed: 'Completed', clear: 'Remove mark', tag: 'manual' }
    : { toggle: 'Ручная отметка', tooltip: 'Если квест не появился или статус неверный из-за ошибки — отметьте вручную.', active: 'В текущие', completed: 'Выполнено', clear: 'Снять отметку', tag: 'вручную' }
}
