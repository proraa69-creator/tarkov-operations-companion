import type { TaskProgressStatus } from '../domain/types'

/** Russian status label of a trader quest (translated at render through uiText). */
export function questStatusText(status: TaskProgressStatus) {
  if (status === 'completed') return 'Выполнено'
  if (status === 'failed') return 'Провалено'
  if (status === 'active') return 'Текущее'
  if (status === 'available') return 'Доступно'
  if (status === 'locked') return 'Недоступно'
  return 'Неизвестно'
}
