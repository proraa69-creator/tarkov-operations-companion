import { useEffect, useLayoutEffect, useState, type MouseEvent } from 'react'
import { Banknote, HeartHandshake, LayoutDashboard, Radio, Receipt, Users } from 'lucide-react'
import { setApiTransport } from '../../website/src/api'
import { EmbeddedOwnerAuth } from '../../website/src/auth'
import { AdminSummary } from '../../website/src/components/admin/AdminSummary'
import { AdminBezebee } from '../../website/src/components/admin/AdminBezebee'
import { AdminPayments } from '../../website/src/components/admin/AdminPayments'
import { AdminInviteRewards } from '../../website/src/components/admin/AdminInviteRewards'
import { AdminUsers } from '../../website/src/components/admin/AdminUsers'
import { AdminReferrals } from '../../website/src/components/admin/AdminReferrals'
import { AdminStreamers } from '../../website/src/components/admin/AdminStreamers'
import { OwnerPayoutsList, PAYOUT_ATTENTION_CHANGED } from '../../website/src/components/OwnerAdmin'
import '../../website/src/styles.css'
import '../../website/src/extras.css'
import '../../website/src/admin.css'
import './siteAdmin.css'
import type { AdminRequest } from './ownerAccess'

/** The site's tabs, in the site's order (website/src/pages/AdminPage.tsx); no «Реклама» (owner, 15.11.2026). */
const SITE_ADMIN_TABS = [
  { id: 'summary', label: 'Сводка', icon: LayoutDashboard },
  { id: 'payments', label: 'Платежи', icon: Receipt },
  { id: 'users', label: 'Пользователи', icon: Users },
  { id: 'referrals', label: 'Привлечение друзей', icon: HeartHandshake },
  { id: 'streamers', label: 'Стримеры', icon: Radio },
] as const
type SiteAdminTab = typeof SITE_ADMIN_TABS[number]['id']
const isTab = (value: string | null): value is SiteAdminTab => SITE_ADMIN_TABS.some((tab) => tab.id === value)

/**
 * «Сводка» of the PC owner app's «Админ панель» (owner, 15.11.2026: «точная копия сайта: сводка, платежи, пользователи,
 * привлечение друзей, стримеры. Рекламу не надо»): the website's own admin tabs, the same components, asking the server
 * through the app's gateway (website/src/api.ts setApiTransport; electron/serviceGateway.ts OWNER_SITE_ADMIN) with the
 * owner signed in to the app. The site's sheets apply only in here (vite.config.ts). A link to an account
 * (/admin?tab=users&q=…) opens «Пользователи» here. The texts are the site's, in Russian, as on the site.
 */
export function SiteAdminSummary({ request, email }: { request: AdminRequest; email: string }) {
  // Before the tabs' own effects ask anything: a layout effect runs ahead of every passive one.
  useLayoutEffect(() => {
    setApiTransport((method, path, body) => request(method, path, body))
    return () => setApiTransport(null)
  }, [request])
  const [view, setView] = useState<{ tab: SiteAdminTab; query?: string; key: number }>({ tab: 'summary', key: 0 })
  // «Стримеры» → красный счётчик новых заявок на вывод (owner, 25.11.2026): опрос при открытии, раз в 5 минут и после решения.
  const [payoutAttention, setPayoutAttention] = useState(0)
  useEffect(() => {
    let active = true
    const load = () => { void request('GET', '/v1/accounts/me/admin/payouts/attention').then((answer) => { if (active) setPayoutAttention(Number((answer as { count?: number }).count ?? 0)) }, () => {}) }
    load()
    const timer = window.setInterval(load, 5 * 60_000)
    window.addEventListener(PAYOUT_ATTENTION_CHANGED, load)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener(PAYOUT_ATTENTION_CHANGED, load) }
  }, [request])

  const followLink = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest?.('a[href^="/admin"]')
    if (!link) return
    event.preventDefault()
    const params = new URL(link.getAttribute('href')!, 'https://raidos.app').searchParams
    const tab = params.get('tab')
    if (isTab(tab)) setView((current) => ({ tab, query: params.get('q') ?? undefined, key: current.key + 1 }))
  }

  return (
    <EmbeddedOwnerAuth email={email}>
      <div className="site-admin" onClickCapture={followLink}>
        <nav className="admin-tabs" role="tablist" aria-label="Разделы сводки">
          {SITE_ADMIN_TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={view.tab === id} className={`admin-tab${view.tab === id ? ' is-active' : ''}`} onClick={() => setView((current) => ({ tab: id, key: current.key + 1 }))}>
              <Icon aria-hidden="true" />{label}
              {id === 'streamers' && payoutAttention > 0 && <span className="admin-tab-count" aria-label={`Новых заявок на вывод: ${payoutAttention}`}>{payoutAttention}</span>}
            </button>
          ))}
        </nav>
        <div role="tabpanel" className="admin-panel-body" key={view.key}>
          {view.tab === 'summary' && <AdminSummary />}
          {view.tab === 'payments' && <><AdminBezebee /><AdminPayments /><AdminInviteRewards /></>}
          {view.tab === 'users' && <AdminUsers query={view.query} />}
          {view.tab === 'referrals' && <AdminReferrals />}
          {view.tab === 'streamers' && <>
            <AdminStreamers />
            <section className="panel owner-panel admin-streamer-payouts" aria-labelledby="site-admin-payouts-title">
              <div className="panel-header"><div className="panel-title" id="site-admin-payouts-title"><Banknote aria-hidden="true" />Выплаты стримерам</div></div>
              <div className="panel-body owner-body"><OwnerPayoutsList /></div>
            </section>
          </>}
        </div>
      </div>
    </EmbeddedOwnerAuth>
  )
}
