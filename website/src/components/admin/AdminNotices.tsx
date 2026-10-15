import { useMemo } from 'react'
import { BellRing, BarChart3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth'
import { OwnerNoticeTools, type OwnerRequest } from '../../../../src/notices/OwnerNoticeTools'
import { ownerCall } from './noticesApi'

/**
 * «Объявления» (owner, 15.10.2026: the owner app's «Объявления по регионам» mirrored here, on the same API): «Создать
 * объявление» / «Создать опрос», the sent ones with their counts and «Отозвать» (src/notices/OwnerNoticeTools.tsx). A
 * survey's statistics are the «Опросы» tab.
 */
export function AdminNotices() {
  const { token } = useAuth()
  const request = useMemo<OwnerRequest | undefined>(() => (token ? (method, path, body) => ownerCall(token, method, path, body) : undefined), [token])
  if (!request) return null
  return (
    <section className="panel owner-panel" aria-labelledby="admin-notices-title">
      <div className="panel-header"><div className="panel-title" id="admin-notices-title"><BellRing aria-hidden="true" />Объявления по регионам</div></div>
      <div className="panel-body owner-body">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Всплывающее окно в приложении (ПК и телефон) у выбранных игроков: при входе или в течение минуты, если приложение открыто; во время рейда ждёт его конца. Баннер для всех — в приложении владельца, «Профиль».</p>
        <OwnerNoticeTools request={request} t={(text) => text} results={(id) => (
          <Link className="button small ghost" to={`/admin?tab=surveys&survey=${id}`}><BarChart3 aria-hidden="true" />Результаты</Link>
        )} />
      </div>
    </section>
  )
}
