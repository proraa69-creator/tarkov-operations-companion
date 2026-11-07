/**
 * The owner's table of reports and ideas (owner, 05.11.2026: «отчеты идут по номерам… Статус должен меняться»). One list of
 * statuses for the server, the site, the owner app and the phone. The owner works them himself (owner, 05.11.2026: «Отдать в
 * работу, убирай, я буду это все сам делать»; «активные, закрытые и в процессе… Взял в работу… Реализовано»; 06.11.2026: «Сделай кнопку "Готово". Не реализовано, а готово»):
 *
 *   review ── «Взял в работу» ──> taken ── «Готово» ──> implemented
 *     │  └── «Уже реализовано» ──> already
 *     └───── «Отменить» ──> rejected
 *
 * Claude's path stays on the server, no button leads to it any more: `queued` (`approve`, written by the owner alone,
 * server/src/services/bugReportStore.ts `ownerWork`) ──> in-progress ──> done ──> deployed, or failed back to the owner.
 * `closed`: a report closed before this table existed.
 */
export const REPORT_WORK_STATUSES = ['review', 'taken', 'implemented', 'queued', 'in-progress', 'done', 'failed', 'deployed', 'rejected', 'already', 'closed'] as const
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
  rejected: 'Отменено',
  already: 'Уже реализовано',
  closed: 'Закрыто',
}

/** A report in one of these has left the working list; on the server its old `status` reads «closed». */
export const REPORT_WORK_CLOSED: readonly ReportWorkStatus[] = ['implemented', 'deployed', 'rejected', 'already', 'closed']
/** Taken up and not finished: «В процессе». */
export const REPORT_WORK_WORKING: readonly ReportWorkStatus[] = ['taken', 'queued', 'in-progress', 'done']
/** What waits for the owner (the red number on «Отчёты»). */
export const REPORT_WORK_AWAITING: readonly ReportWorkStatus[] = ['review', 'failed']
/** The plan can be corrected only before the owner gives it away. */
export const REPORT_PLAN_EDITABLE: readonly ReportWorkStatus[] = ['review', 'failed']

export type ReportWorkAction = 'approve' | 'take' | 'implemented' | 'reject' | 'already' | 'reopen'
export const REPORT_WORK_ACTION_IDS = ['approve', 'take', 'implemented', 'reject', 'already', 'reopen'] as const satisfies readonly ReportWorkAction[]
export const REPORT_WORK_ACTIONS: Record<ReportWorkAction, { label: string; from: readonly ReportWorkStatus[]; to: ReportWorkStatus }> = {
  approve: { label: 'Отдать в работу', from: ['review', 'failed'], to: 'queued' },
  take: { label: 'Взял в работу', from: ['review', 'failed'], to: 'taken' },
  implemented: { label: 'Готово', from: ['taken', 'queued', 'in-progress', 'done'], to: 'implemented' },
  reject: { label: 'Отменить', from: ['review', 'failed', 'queued'], to: 'rejected' },
  // A quest report in the work can be closed by putting its point on the map (src/pages/RequestsPage.tsx).
  already: { label: 'Уже реализовано', from: ['review', 'failed', 'queued', 'taken'], to: 'already' },
  reopen: { label: 'Вернуть в активные', from: ['taken', 'queued', 'implemented', 'rejected', 'already', 'closed'], to: 'review' },
}

export const REPORT_TEXT_LIMITS = { summary: 1000, plan: 3000, note: 1000 }

export type ReportTableView = 'active' | 'working' | 'closed'

export const reportKindLabel = (kind: 'bug' | 'idea') => (kind === 'idea' ? 'Предложение' : 'Отчёт')
