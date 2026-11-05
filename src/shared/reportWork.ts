/**
 * The owner's table of reports and ideas (owner, 05.11.2026: «отчеты идут по номерам… Статус изначально ожидает проверки…
 * будет «отдать в работу», «отклонить» и «уже реализовано»… Статус должен меняться: выполнено. И конечный статус добавлено
 * на сервер»). One list of statuses for the server, the site, the owner app and the phone.
 *
 *   review ── «Отдать в работу» ──> queued ──> in-progress ──> done ──> deployed
 *     │  │                                         └──> failed (back to the owner)
 *     │  └── «Уже реализовано» ──> already
 *     └───── «Отклонить» ──> rejected
 *
 * `queued` is written by the owner's button alone (server/src/services/bugReportStore.ts `ownerWork`); nothing a player
 * sends and nothing Claude's script does can put a report there. `closed`: a report closed before this table existed.
 */
export const REPORT_WORK_STATUSES = ['review', 'queued', 'in-progress', 'done', 'failed', 'deployed', 'rejected', 'already', 'closed'] as const
export type ReportWorkStatus = (typeof REPORT_WORK_STATUSES)[number]

export const REPORT_WORK_LABELS: Record<ReportWorkStatus, string> = {
  review: 'Ожидает проверки',
  queued: 'Отдано в работу',
  'in-progress': 'В работе',
  done: 'Выполнено',
  failed: 'Не реализовано',
  deployed: 'Добавлено на сервер',
  rejected: 'Отклонено',
  already: 'Уже реализовано',
  closed: 'Закрыто',
}

/** A report in one of these has left the working list; on the server its old `status` reads «closed». */
export const REPORT_WORK_CLOSED: readonly ReportWorkStatus[] = ['deployed', 'rejected', 'already', 'closed']
/** What waits for the owner (the red number on «Отчёты»). */
export const REPORT_WORK_AWAITING: readonly ReportWorkStatus[] = ['review', 'failed']
/** The plan can be corrected only before the owner gives it away. */
export const REPORT_PLAN_EDITABLE: readonly ReportWorkStatus[] = ['review', 'failed']

export type ReportWorkAction = 'approve' | 'reject' | 'already' | 'reopen'
export const REPORT_WORK_ACTIONS: Record<ReportWorkAction, { label: string; from: readonly ReportWorkStatus[]; to: ReportWorkStatus }> = {
  approve: { label: 'Отдать в работу', from: ['review', 'failed'], to: 'queued' },
  reject: { label: 'Отклонить', from: ['review', 'failed', 'queued'], to: 'rejected' },
  already: { label: 'Уже реализовано', from: ['review', 'failed', 'queued'], to: 'already' },
  reopen: { label: 'Вернуть на проверку', from: ['queued', 'rejected', 'already', 'closed'], to: 'review' },
}

export const REPORT_TEXT_LIMITS = { summary: 1000, plan: 3000, note: 1000 }
/** Claude has not looked in for this long: the computer is probably off, and the table says so. */
export const REPORT_AGENT_SILENT_MS = 45 * 60 * 1000

export type ReportTableView = 'active' | 'closed'

export const reportKindLabel = (kind: 'bug' | 'idea') => (kind === 'idea' ? 'Предложение' : 'Отчёт')
