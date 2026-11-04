import { useEffect, useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { UPDATE_HISTORY_PATH, type UpdateHistoryAnswer, type UpdateHistoryRow } from '../shared/updateHistory'
import { errorText } from './adminFormat'
import type { AdminRequest } from './ownerAccess'
import { UpdateHistoryTable } from './UpdateHistoryTable'

/** «История обновлений» of the owner's app: the list from the server (only the owner's account gets it). */
export function AdminUpdateHistorySection({ request }: { request: AdminRequest }) {
  const [rows, setRows] = useState<UpdateHistoryRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    request('GET', UPDATE_HISTORY_PATH).then(
      (answer) => { if (alive) setRows((answer as UpdateHistoryAnswer).versions) },
      (reason: unknown) => { if (alive) setError(errorText(reason)) },
    )
    return () => { alive = false }
  }, [request])

  return (
    <section className="panel admin-section" aria-labelledby="admin-history-title">
      <div className="panel-header"><div><div className="eyebrow">{uiLabel('Все версии, новые сверху')}</div><div className="panel-title" id="admin-history-title">{uiLabel('История обновлений')}</div></div><HistoryIcon size={18} className="brass" aria-hidden="true" /></div>
      <div className="panel-body">
        {error && <p className="dim" role="alert">{uiLabel(error)}</p>}
        {!rows && !error && <p className="dim">{uiLabel('Загружаем…')}</p>}
        {rows && <UpdateHistoryTable rows={rows} t={uiLabel} />}
      </div>
    </section>
  )
}
