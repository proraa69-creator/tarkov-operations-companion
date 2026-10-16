import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import './adminPanel.css'

/**
 * Where the owner's tools used to be (the profile): one line that they are in «Админ панель» now, with a link to the
 * section (owner, 16.10.2026: «все функции админа» in one place).
 */
export function MovedToAdminPanel({ what, tab }: { what: string; tab: string }) {
  return (
    <section className="panel admin-moved">
      <div className="panel-body admin-moved-body">
        <ShieldCheck size={16} className="brass" aria-hidden="true" />
        <span>{uiLabel(what)} — {uiLabel('перенесено в Админ панель')}</span>
        <Link className="button small ghost" to={`/admin?tab=${tab}`}>{uiLabel('Открыть')}<ArrowRight size={13} aria-hidden="true" /></Link>
      </div>
    </section>
  )
}
