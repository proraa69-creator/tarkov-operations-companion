import { historyDate, type UpdateHistoryRow } from '../shared/updateHistory'
import './updateHistoryTable.css'

const same = (text: string) => text

/**
 * «История обновлений»: one table for the site, the owner's app and the admin app, newest first. `t` translates the
 * column names where the panel has a language switch; the rows stay Russian.
 */
export function UpdateHistoryTable({ rows, t = same }: { rows: readonly UpdateHistoryRow[]; t?: (text: string) => string }) {
  return (
    <div className="uh-wrap">
      <table className="uh-table">
        <thead>
          <tr>
            <th scope="col" className="uh-col-version">{t('Версия')}</th>
            <th scope="col" className="uh-col-date">{t('Дата')}</th>
            <th scope="col">{t('Что изменилось')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.version}>
              <td className="uh-version">{row.version}</td>
              <td className="uh-date">{historyDate(row.date)}</td>
              <td className="uh-changes"><ul>{row.changes.map((line) => <li key={line}>{line}</li>)}</ul></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
