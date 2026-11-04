import { useEffect, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import type { UpdateHistoryRow } from '../shared/updateHistory'
import { adminApi } from './adminApi'
import { errorText } from './adminFormat'
import { AdminLoading } from './adminShared'
import { UpdateHistoryTable } from './UpdateHistoryTable'

/** «История обновлений» of the admin app: in its own window, as «Стримеры» and «Пригласи друга». */
export function UpdateHistorySheet({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<UpdateHistoryRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    adminApi.updateHistory().then(
      (answer) => { if (active) setRows(answer.versions) },
      (reason: unknown) => { if (active) setError(errorText(reason)) },
    )
    return () => { active = false }
  }, [])

  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet admin-wide-sheet" role="dialog" aria-modal="true" aria-label={uiText('История обновлений')}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button><div><strong>{uiText('История обновлений')}</strong><small>{uiText('Все версии, новые сверху')}</small></div><button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button></header>
      <div className="admin-sheet-scroll">
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {!rows && !error && <AdminLoading />}
        {rows && <UpdateHistoryTable rows={rows} t={uiLabel} />}
      </div>
    </section>
  </div>
}
