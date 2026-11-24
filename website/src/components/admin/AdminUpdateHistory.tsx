import { useCallback } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { UpdateHistoryTable } from '../../../../src/admin/UpdateHistoryTable'
import { UPDATE_HISTORY_PATH, type UpdateHistoryAnswer } from '../../../../src/shared/updateHistory'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { useAdminData } from './adminData'
import { ownerCall } from './noticesApi'

/** «История обновлений»: every version with its main changes, from the owner-only route (server/src/routes/ownerAdmin.ts). */
export function AdminUpdateHistory() {
  const list = useAdminData(useCallback((token: string) => ownerCall<UpdateHistoryAnswer>(token, 'GET', UPDATE_HISTORY_PATH), []))
  return (
    <section className="panel owner-panel" aria-labelledby="admin-history-title">
      <div className="panel-header"><div className="panel-title" id="admin-history-title"><HistoryIcon aria-hidden="true" />История обновлений</div></div>
      <div className="panel-body owner-body">
        {list.error && <Notice tone={list.error.offline ? 'offline' : 'error'}>{list.error.message}</Notice>}
        {!list.data && !list.error && <Loading />}
        {list.data && <UpdateHistoryTable rows={list.data.versions} />}
      </div>
    </section>
  )
}
