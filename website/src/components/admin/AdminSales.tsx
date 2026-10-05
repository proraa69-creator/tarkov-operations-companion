import { CircleCheck, CircleSlash, MonitorCog, ScrollText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api } from '../../api'
import { Notice } from '../Notice'
import { Pager } from './AdminPayments'
import { Loading } from './adminShared'
import { dateTime, formatRub, PLAN_LABEL, useAdminData } from './adminData'
import { AdminYookassaSettings } from './AdminYookassaSettings'
import { AdminLavaSettings } from './AdminLavaSettings'

const On = ({ on, children }: { on: boolean; children: string }) => (
  <span className={`tag ${on ? 'green' : ''}`}>{on ? <CircleCheck aria-hidden="true" /> : <CircleSlash aria-hidden="true" />}{children}</span>
)

/** Sales overview and owner-only Lava controls; secrets remain encrypted in the owner app. */
export function AdminSales() {
  const sales = useAdminData(useCallback((token: string) => api.adminSalesSettings(token), []))
  const data = sales.data
  return (
    <div className="admin-stack">
      <Notice tone="info">Lava.top можно настроить ниже. Стоимость подписки задаётся в кабинете Lava.top. Настройки ЮKassa и общая доля стримеров меняются в приложении: «Сервер» → «Оплата».</Notice>
      <AdminYookassaSettings />
      <AdminLavaSettings />
      {sales.error && <Notice tone={sales.error.offline ? 'offline' : 'error'}>{sales.error.message}</Notice>}
      {!data && !sales.error && <Loading />}
      {data && (
        <>
          <div className="admin-chips">
            <On on={data.providers.yookassa}>ЮKassa (Россия и СНГ)</On>
            <On on={data.providers.lava}>Lava.top (другие страны)</On>
            <On on={data.providers.autopay}>Автоплатежи ЮKassa</On>
            <On on={Boolean(data.yookassa?.receipts)}>Чеки 54-ФЗ</On>
          </div>
          {!data.enabled && <Notice tone="warn">Оплата сейчас выключена: тарифы на сайте не продаются.</Notice>}
          {data.plans.length > 0 && (
            <div className="table-scroll">
              <table className="pay-table admin-table">
                <thead><tr><th scope="col">Тариф</th><th scope="col" className="num">Цена, ₽</th><th scope="col" className="num">Скидка</th></tr></thead>
                <tbody>
                  {data.plans.map((plan) => (
                    <tr key={plan.id}><th scope="row">{PLAN_LABEL[plan.id]}</th><td className="num mono">{plan.price === null ? 'на странице Lava.top' : formatRub(plan.price)}</td><td className="num mono">{plan.discountPercent ? `${plan.discountPercent} %` : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="admin-facts">
            <div><dt>Цена месяца</dt><dd className="mono">{data.yookassa ? `${formatRub(data.yookassa.monthPrice)} ₽` : '—'}</dd></div>
            <div><dt>Общая доля стримеров</dt><dd className="mono">{data.streamerPercent} %</dd></div>
            <div><dt>Пробный период по ссылке</dt><dd className="mono">{data.trialDays} дн.</dd></div>
            <div><dt>Адрес сайта для возврата</dt><dd className="mono">{data.yookassa?.publicUrl ?? '—'}</dd></div>
            <div><dt>Lava.top: валюта и курс</dt><dd className="mono">{data.lava ? `${data.lava.currency} · ${formatRub(data.lava.rubRate)} ₽` : '—'}</dd></div>
            <div><dt>Lava.top: способ оплаты</dt><dd className="mono">{data.lava ? data.lava.paymentMethod ?? 'любой' : '—'}</dd></div>
          </dl>
          <span className="field-hint"><MonitorCog size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />Индивидуальная доля и отключение ссылки отдельного стримера — во вкладке «Стримеры».</span>
        </>
      )}
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = {
  'payments.yookassa-settings': 'Настройки оплаты ЮKassa',
  'map.boss-place': 'Босс поставлен на карту',
  'map.boss-remove': 'Босс убран с карты',
  'payments.lava-settings': 'Настройки оплаты Lava.top',
  'payments.lava-test': 'Проверка вебхука Lava.top',
  'subscription.grant': 'Выдана подписка',
  'autopay.cancel': 'Отменено автопродление',
  'account.block': 'Заблокирован вход',
  'account.unblock': 'Разблокирован вход',
  'sessions.revoke': 'Сброшены сессии',
  'streamer.percent': 'Доля стримера',
  'streamer.link': 'Ссылка стримера',
  'streamer.revoke': 'Снят статус стримера',
  'streamer.invite': 'Приглашение стримера',
  'payout.decide': 'Решение по выплате',
  'payout.limits': 'Интервал автовыплат',
  'payments.export': 'Выгрузка платежей CSV',
  'device.revoke': 'Отключено устройство',
  'server.update-check': 'Проверка обновления сервера',
  'server.update-install': 'Установка обновления сервера',
  'server.rollback': 'Откат сервера на предыдущую версию',
}
const DETAIL_LABEL: Record<string, string> = { days: 'дней', reason: 'причина', paidUntil: 'до', percent: 'доля', enabled: 'включена', status: 'статус', comment: 'комментарий', min: 'мин', max: 'макс', rows: 'строк', sessions: 'сессий', from: 'с', to: 'по', provider: 'способ', plan: 'тариф', q: 'поиск' }

const VALUE_LABEL: Record<string, string> = { paid: 'выплачено', rejected: 'отклонено', pending: 'ожидает', succeeded: 'оплачен', canceled: 'отменён' }

function detailText(details: Record<string, unknown> | undefined) {
  if (!details) return ''
  return Object.entries(details).map(([key, value]) => {
    const text = typeof value === 'boolean' ? (value ? 'да' : 'нет') : key === 'paidUntil' && typeof value === 'string' ? dateTime.format(new Date(value)) : key === 'status' ? VALUE_LABEL[String(value)] ?? String(value) : String(value)
    return `${DETAIL_LABEL[key] ?? key}: ${text}`
  }).join(' · ')
}

const AUDIT_PAGE = 100

/** «Журнал»: every owner action — who, when, what, to whom. */
export function AdminAudit() {
  const [page, setPage] = useState(0)
  const audit = useAdminData(useCallback((token: string) => api.adminAudit(token, AUDIT_PAGE, page * AUDIT_PAGE), [page]))
  const data = audit.data
  return (
    <div className="admin-stack">
      {audit.error && <Notice tone={audit.error.offline ? 'offline' : 'error'}>{audit.error.message}</Notice>}
      {!data && !audit.error && <Loading />}
      {data && data.entries.length === 0 && <div className="muted admin-empty"><ScrollText size={14} aria-hidden="true" /> Действий пока не было.</div>}
      {data && data.entries.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table admin-audit">
            <thead><tr><th scope="col">Когда (МСК)</th><th scope="col">Кто</th><th scope="col">Действие</th><th scope="col">Кому / что</th><th scope="col">Подробности</th></tr></thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{dateTime.format(new Date(entry.at))}</td>
                  <td className="admin-email">{entry.actor}</td>
                  <td>{ACTION_LABEL[entry.action] ?? entry.action}</td>
                  <td className="admin-email mono">{entry.target ?? '—'}</td>
                  <td className="admin-wrap">{detailText(entry.details) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} size={AUDIT_PAGE} onPage={setPage} />}
    </div>
  )
}
