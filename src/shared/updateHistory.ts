/**
 * «История обновлений» (owner, 05.11.2026: «веди таблицу по всем обновлениям… в админ панели на сайте и приложении»): what
 * the owner-only route answers (server/src/routes/ownerAdmin.ts) and the site, the owner's app and the admin app show. The
 * list itself, src/data/updateHistory.json, stays on the server: no client imports it, the players' apps do not carry it.
 */
export interface UpdateHistoryRow {
  /** As people read it: 0.6.0.244 (package.json holds 0.6.0-244). */
  version: string
  /** YYYY-MM-DD, the owner's day (Bangkok) of the version's commit. */
  date: string
  /** Russian in every language: short lines, the main things only. */
  changes: string[]
  /**
   * The players' reports this version implements, by number. Those still «В процессе» close by themselves, with their
   * author's window, once the version is live (server/src/services/releaseReports.ts); any other report is left alone.
   */
  reports?: number[]
}

export interface UpdateHistoryAnswer { versions: UpdateHistoryRow[] }

export const UPDATE_HISTORY_PATH = '/v1/accounts/me/admin/update-history'

/** «2026-11-05» → «05.11.2026», from the text itself: no time zone can move the day. */
export const historyDate = (date: string) => date.split('-').reverse().join('.')
