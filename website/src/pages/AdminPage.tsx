import { ArrowLeft, Banknote, Crown, LayoutDashboard, LoaderCircle, Radio, Receipt, ScrollText, Settings2, ShieldAlert, ShieldCheck, Users } from 'lucide-react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { AdminPayments } from '../components/admin/AdminPayments'
import { AdminAudit, AdminSales } from '../components/admin/AdminSales'
import { AdminStreamers } from '../components/admin/AdminStreamers'
import { AdminSummary } from '../components/admin/AdminSummary'
import { AdminUsers } from '../components/admin/AdminUsers'
import { AdminSecurity } from '../components/admin/AdminSecurity'
import { OwnerPayoutsList } from '../components/OwnerAdmin'
import '../extras.css'
import '../admin.css'

const TABS = [
  { id: 'summary', label: 'Сводка', icon: LayoutDashboard },
  { id: 'payments', label: 'Платежи', icon: Receipt },
  { id: 'users', label: 'Пользователи', icon: Users },
  { id: 'streamers', label: 'Стримеры', icon: Radio },
  { id: 'payouts', label: 'Выплаты', icon: Banknote },
  { id: 'sales', label: 'Настройки продаж', icon: Settings2 },
  { id: 'audit', label: 'Журнал действий', icon: ScrollText },
  { id: 'security', label: 'Безопасность', icon: ShieldCheck },
] as const
type TabId = typeof TABS[number]['id']

/**
 * «Админ-панель» (/admin, ?tab=…): only for the account the server marks `owner` (TARKOV_OWNER_EMAILS). The page is
 * just a view: every request is checked on the server, which answers 404 to anybody else.
 */
export function AdminPage() {
  const auth = useAuth()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: TabId = TABS.some((item) => item.id === requested) ? requested as TabId : 'summary'

  if (auth.status === 'signed-out') return <Navigate to="/login" replace state={{ from: '/admin' }} />
  if (auth.status === 'loading' || (auth.status === 'ready' && !auth.account)) {
    return <div className="container page"><div className="panel center-state"><LoaderCircle className="spinner" aria-hidden="true" /><div>Загружаем…</div></div></div>
  }
  if (!auth.account?.owner) {
    return (
      <div className="container page page-in">
        <div className="panel center-state" style={{ padding: 24 }}>
          <ShieldAlert aria-hidden="true" />
          <div>Эта страница доступна только владельцу сервиса.</div>
          <Link to="/cabinet" className="button ghost"><ArrowLeft aria-hidden="true" />В личный кабинет</Link>
        </div>
      </div>
    )
  }

  const current = TABS.find((item) => item.id === tab)!
  return (
    <div className="page page-in admin-page">
      <div className="container">
        <div className="page-header">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow"><Crown size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 6 }} />Владелец · {auth.account.email}</div>
            <h1 className="page-title">Админ-панель</h1>
          </div>
          <Link to="/cabinet" className="button ghost"><ArrowLeft aria-hidden="true" />Личный кабинет</Link>
        </div>
        <nav className="admin-tabs" role="tablist" aria-label="Разделы админ-панели">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" id={`admin-tab-${id}`} aria-selected={tab === id} aria-controls="admin-tabpanel" className={`admin-tab${tab === id ? ' is-active' : ''}`} onClick={() => setParams(id === 'summary' ? {} : { tab: id }, { replace: true })}>
              <Icon aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
        <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} className="admin-panel-body">
          {tab === 'streamers' || tab === 'payouts' ? null : <h2 className="visually-hidden">{current.label}</h2>}
          {tab === 'summary' && <AdminSummary />}
          {tab === 'payments' && <AdminPayments />}
          {tab === 'users' && <AdminUsers />}
          {tab === 'streamers' && <AdminStreamers />}
          {tab === 'payouts' && (
            <section className="panel owner-panel" aria-labelledby="admin-payouts-title">
              <div className="panel-header"><div className="panel-title" id="admin-payouts-title"><Banknote aria-hidden="true" />Выплаты стримерам</div></div>
              <div className="panel-body owner-body"><OwnerPayoutsList /></div>
            </section>
          )}
          {tab === 'sales' && <AdminSales />}
          {tab === 'audit' && <AdminAudit />}
          {tab === 'security' && <AdminSecurity />}
        </div>
      </div>
    </div>
  )
}
