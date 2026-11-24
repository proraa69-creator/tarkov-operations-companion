/**
 * The owner's table of reports and ideas (owner, 05.11.2026: «отчеты идут по номерам… Статус должен меняться»). One list of
 * statuses for the server, the site, the owner app and the phone. The owner works them himself (owner, 05.11.2026: «Отдать в
 * работу, убирай, я буду это все сам делать»; «активные, закрытые и в процессе… Взял в работу… Реализовано»; 06.11.2026: «Сделай кнопку "Готово". Не реализовано, а готово»):
 *
 *   review ── «Взял в работу» ──> taken ── «Готово» ──> implemented
 *     │  ├── «Разъяснить» (a bug; also from taken) ──> explained
 *     │  └── «Уже реализовано» (an idea) ──> already
 *     └───── «Отклонить» ──> rejected
 *
 * A bug and an idea have their own buttons (owner, 25.11.2026: «ошибки и предложения должны быть разные кнопки. „Взял в работу“
 * должно быть у всех»): a bug's «Разъяснить» («если всё-таки это не ошибка, а человек что-то не досмотрел») closes it and opens
 * the answer to its author in the support chat; an idea keeps «Уже реализовано». The player hears only of «Взял в работу» and
 * «Готово» (server/src/routes/bugReports.ts `workReport`): «Разъяснить» and «Отклонить» close a report without a word.
 *
 * Claude's path stays on the server, no button leads to it any more: `queued` (`approve`, written by the owner alone,
 * server/src/services/bugReportStore.ts `ownerWork`) ──> in-progress ──> done ──> deployed, or failed back to the owner.
 * `closed`: a report closed before this table existed.
 */
export const REPORT_WORK_STATUSES = ['review', 'taken', 'implemented', 'queued', 'in-progress', 'done', 'failed', 'deployed', 'rejected', 'already', 'explained', 'closed'] as const
export type ReportWorkStatus = (typeof REPORT_WORK_STATUSES)[number]

export const REPORT_WORK_LABELS: Record<ReportWorkStatus, string> = {
  review: 'Активный',
  taken: 'В процессе',
  implemented: 'Готово',
  queued: 'Отдано в работу',
  'in-progress': 'В работе',
  done: 'Выполнено',
  failed: 'Не реализовано',
  deployed: 'Добавлено на сервер',
  rejected: 'Отклонено',
  already: 'Уже реализовано',
  explained: 'Разъяснено',
  closed: 'Закрыто',
}

/** A report in one of these has left the working list; on the server its old `status` reads «closed». */
export const REPORT_WORK_CLOSED: readonly ReportWorkStatus[] = ['implemented', 'deployed', 'rejected', 'already', 'explained', 'closed']
/** Taken up and not finished: «В процессе». */
export const REPORT_WORK_WORKING: readonly ReportWorkStatus[] = ['taken', 'queued', 'in-progress', 'done']
/** What waits for the owner (the red number on «Отчёты»). */
export const REPORT_WORK_AWAITING: readonly ReportWorkStatus[] = ['review', 'failed']
/** The plan can be corrected only before the owner gives it away. */
export const REPORT_PLAN_EDITABLE: readonly ReportWorkStatus[] = ['review', 'failed']

export type ReportWorkAction = 'approve' | 'take' | 'implemented' | 'reject' | 'already' | 'explain' | 'reopen'
export const REPORT_WORK_ACTION_IDS = ['approve', 'take', 'implemented', 'reject', 'already', 'explain', 'reopen'] as const satisfies readonly ReportWorkAction[]
export const REPORT_WORK_ACTIONS: Record<ReportWorkAction, { label: string; from: readonly ReportWorkStatus[]; to: ReportWorkStatus }> = {
  approve: { label: 'Отдать в работу', from: ['review', 'failed'], to: 'queued' },
  take: { label: 'Взял в работу', from: ['review', 'failed'], to: 'taken' },
  implemented: { label: 'Готово', from: ['taken', 'queued', 'in-progress', 'done'], to: 'implemented' },
  reject: { label: 'Отклонить', from: ['review', 'failed', 'queued'], to: 'rejected' },
  // A quest report in the work can be closed by putting its point on the map (src/pages/RequestsPage.tsx).
  already: { label: 'Уже реализовано', from: ['review', 'failed', 'queued', 'taken'], to: 'already' },
  // A bug only (the server refuses it on an idea): not a bug after all, the player is answered in the support chat.
  explain: { label: 'Разъяснить', from: ['review', 'failed', 'queued', 'taken'], to: 'explained' },
  reopen: { label: 'Вернуть в активные', from: ['taken', 'queued', 'implemented', 'rejected', 'already', 'explained', 'closed'], to: 'review' },
}

/**
 * The owner's buttons on a report of this kind and status: a bug's «Разъяснить», an idea's «Уже реализовано»; «Взял в работу»,
 * «Готово» and «Отклонить» for both. One list for the site, the owner app and the phone (src/reports/ReportsTable.tsx).
 */
export function reportWorkButtons(kind: 'bug' | 'idea', status: ReportWorkStatus): ReportWorkAction[] {
  const buttons: ReportWorkAction[] = REPORT_WORK_WORKING.includes(status)
    ? (kind === 'bug' ? ['implemented', 'explain', 'reopen'] : ['implemented', 'reopen'])
    : REPORT_WORK_CLOSED.includes(status) ? ['reopen']
      : kind === 'bug' ? ['take', 'explain', 'reject'] : ['take', 'already', 'reject']
  return buttons.filter((action) => REPORT_WORK_ACTIONS[action].from.includes(status))
}

export const REPORT_TEXT_LIMITS = { summary: 1000, plan: 3000, note: 1000 }

export type ReportTableView = 'active' | 'working' | 'closed'

export const reportKindLabel = (kind: 'bug' | 'idea') => (kind === 'idea' ? 'Предложение' : 'Отчёт')
