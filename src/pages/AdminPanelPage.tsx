import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BellRing, ClipboardList, LayoutGrid, Megaphone, Power, ShieldCheck, Target } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { OwnerAnnouncementPanel } from '../announcement/OwnerAnnouncementPanel'
import { OwnerNoticeTools } from '../notices/OwnerNoticeTools'
import { AdminSurveyResults } from '../admin/AdminSurveyResults'
import { AdminFeaturesSection } from '../admin/AdminFeaturesSection'
import { AdminQuestsSection } from '../admin/AdminQuestsSection'
import { AdminBlocksSection } from '../admin/AdminBlocksSection'
import { ownerRequest, useOwnerAccess } from '../admin/ownerAccess'
import type { AdminRequest } from '../admin/ownerAccess'
import '../admin/adminPanel.css'

export type AdminSectionId = 'notices' | 'surveys' | 'banner' | 'features' | 'quests' | 'blocks'

const ADMIN_SECTIONS: ReadonlyArray<{ id: AdminSectionId; label: string; hint: string; icon: typeof Megaphone }> = [
  { id: 'notices', label: 'Объявления', hint: 'Всем или по регионам', icon: BellRing },
  { id: 'surveys', label: 'Опросы', hint: 'Создать, результаты', icon: ClipboardList },
  { id: 'banner', label: 'Баннер', hint: 'Сверху у всех игроков', icon: Megaphone },
  { id: 'features', label: 'Функции', hint: 'Включить или выключить у всех', icon: Power },
  { id: 'quests', label: 'Квесты', hint: 'Ивент-квесты и конструктор', icon: Target },
  { id: 'blocks', label: 'Блоки', hint: '«Обзор» для всех', icon: LayoutGrid },
]

const isSection = (value: string | null): value is AdminSectionId => ADMIN_SECTIONS.some((section) => section.id === value)

/**
 * «Админ панель» of the owner's app (owner, 16.10.2026: «в ней должны быть все функции админа… короче там должен быть
 * логический конструктор, который я смогу редактировать и обновлять информацию, без надобности загружать обновление
 * сервера. надо добавить квест? добавил сам через свою админ панель. она тут же появилась у всех пользователей»).
 * Every section writes to the server, and the players' apps pick the change up by themselves:
 * - «Объявления» / «Опросы»: popups for all or by region (server/src/routes/notices.ts), with the results;
 * - «Баннер»: the line at the top of every app (routes/announcement.ts);
 * - «Функции»: switches for everybody (the position on the map);
 * - «Квесты»: the event quests and the quest constructor on the map;
 * - «Блоки»: the Overview every player starts from (routes/overviewDefaults.ts).
 * The section is in the address (?tab=…), so a link can open it.
 */
export function AdminPanelPage() {
  const access = useOwnerAccess()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab')
  const section: AdminSectionId = isSection(tab) ? tab : 'notices'
  const request = useMemo(() => ownerRequest(), [])
  const choose = (id: AdminSectionId) => setParams({ tab: id }, { replace: true })

  let body: ReactNode
  if (!request || access === 'not-owner') {
    body = <section className="panel admin-section"><div className="panel-body"><p>{uiLabel('Админ панель доступна только в приложении владельца, вошедшем в аккаунт владельца.')}</p></div></section>
  } else if (access === 'signed-out') {
    body = <section className="panel admin-section"><div className="panel-body"><p>{uiLabel('Войдите в аккаунт владельца на странице «Профиль» — без него сервер не примет изменения.')}</p><Link className="button small primary" to="/profile">{uiLabel('Открыть профиль')}</Link></div></section>
  } else {
    body = <AdminSection id={section} request={request} />
  }

  return (
    <div className="page admin-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiLabel('Только для владельца')}</div>
          <h1 className="page-title">{uiLabel('Админ панель')}</h1>
          <p className="page-subtitle">{uiLabel('Всё, что вы меняете здесь, сохраняется на сервере и само появляется у всех игроков — без обновления приложения и сервера.')}</p>
        </div>
        <span className={`tag ${access === 'owner' ? 'green' : access === 'offline' ? 'danger' : ''}`}><ShieldCheck size={12} aria-hidden="true" />{uiLabel(access === 'owner' ? 'аккаунт владельца' : access === 'offline' ? 'сервер недоступен' : access === 'signed-out' ? 'вход не выполнен' : 'проверка доступа…')}</span>
      </header>
      <div className="admin-layout">
        <nav className="admin-sections" role="tablist" aria-label={uiLabel('Разделы админ панели')} aria-orientation="vertical">
          {ADMIN_SECTIONS.map(({ id, label, hint, icon: Icon }) => (
            <button key={id} type="button" role="tab" id={`admin-tab-${id}`} aria-selected={section === id} aria-controls="admin-section" className={`admin-section-tab${section === id ? ' active' : ''}`} onClick={() => choose(id)}>
              <Icon size={16} aria-hidden="true" />
              <span><strong>{uiLabel(label)}</strong><small>{uiLabel(hint)}</small></span>
            </button>
          ))}
        </nav>
        <div className="admin-content" id="admin-section" role="tabpanel" aria-labelledby={`admin-tab-${section}`}>{body}</div>
      </div>
    </div>
  )
}

function AdminSection({ id, request }: { id: AdminSectionId; request: AdminRequest }) {
  switch (id) {
    case 'notices':
      return (
        <section className="panel admin-section owner-notices-panel" aria-labelledby="admin-notices-title">
          <div className="panel-header"><div><div className="eyebrow">{uiLabel('Всплывающее окно у игроков')}</div><div className="panel-title" id="admin-notices-title">{uiLabel('Объявления')}</div></div><BellRing size={18} className="brass" aria-hidden="true" /></div>
          <div className="panel-body">
            <p className="dim owner-notices-intro">{uiLabel('Всем игрокам или по регионам (СНГ, Европа, другие), оплатившим или нет. Окно появится при входе или в течение минуты, если приложение открыто; во время рейда ждёт его конца.')}</p>
            <OwnerNoticeTools only="announcement" request={request} t={uiLabel} results={() => null} />
          </div>
        </section>
      )
    case 'surveys':
      return (
        <section className="panel admin-section owner-notices-panel" aria-labelledby="admin-surveys-title">
          <div className="panel-header"><div><div className="eyebrow">{uiLabel('Всплывающее окно у игроков')}</div><div className="panel-title" id="admin-surveys-title">{uiLabel('Опросы')}</div></div><ClipboardList size={18} className="brass" aria-hidden="true" /></div>
          <div className="panel-body">
            <p className="dim owner-notices-intro">{uiLabel('Опрос для всех или по регионам. Результаты — здесь, подробная таблица с почтами — на сайте.')}</p>
            <OwnerNoticeTools only="survey" request={request} t={uiLabel} results={(survey) => <AdminSurveyResults id={survey} request={request} />} />
          </div>
        </section>
      )
    case 'banner':
      return <OwnerAnnouncementPanel />
    case 'features':
      return <AdminFeaturesSection request={request} />
    case 'quests':
      return <AdminQuestsSection />
    case 'blocks':
      return <AdminBlocksSection request={request} />
  }
}
