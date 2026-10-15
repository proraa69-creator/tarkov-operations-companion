/** «Журнал действий» of the admin panel (the «Настройки продаж» section was removed, owner 13.10.2026). */
import { ScrollText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api } from '../../api'
import { Notice } from '../Notice'
import { Pager } from './AdminPayments'
import { Loading } from './adminShared'
import { dateTime, useAdminData } from './adminData'

const ACTION_LABEL: Record<string, string> = {
  'payments.yookassa-settings': 'Настройки оплаты ЮKassa',
  'map.boss-place': 'Босс поставлен на карту',
  'map.boss-remove': 'Босс убран с карты',
  'map.quest-point': 'Исправлена точка квеста',
  'map.quest-text': 'Исправлен текст квеста',
  'subscription.grant': 'Выдана подписка',
  'autopay.cancel': 'Отменено автопродление',
  'account.block': 'Заблокирован вход',
  'account.unblock': 'Разблокирован вход',
  'sessions.revoke': 'Сброшены сессии',
  'eft.unbind': 'Отвязан аккаунт Escape from Tarkov',
  'account.delete': 'Удалён аккаунт',
  'streamer.percent': 'Доля стримера',
  'streamer.link': 'Ссылка стримера',
  'streamer.revoke': 'Снят статус стримера',
  'streamer.invite': 'Приглашение стримера',
  'payout.decide': 'Решение по выплате',
  'payout.limits': 'Интервал автовыплат',
  'invite.decide': 'Решение по награде за друга',
  'bug.status': 'Статус баг-репорта',
  'support.reply': 'Ответ в чате поддержки',
  'support.resolve': 'Переписка удалена («Проблема решена»)',
  'announcement.set': 'Изменено уведомление для игроков',
  'features.minimap': 'Функции мини-карты для всех игроков',
  'features.minimapOverlay': 'Окно мини-карты поверх игры для всех игроков',
  'notice.send': 'Отправлено объявление по регионам',
  'notice.withdraw': 'Отозвано объявление или опрос',
  'survey.publish': 'Опубликован опрос',
  'survey.export': 'Выгрузка ответов опроса CSV',
  'support.start': 'Начат чат с пользователем',
  'requests-key.create': 'Создан ключ Claude для чтения заявок',
  'requests-key.revoke': 'Отозван ключ Claude для чтения заявок',
  'payments.export': 'Выгрузка платежей CSV',
  'device.revoke': 'Отключено устройство',
  'server.update-check': 'Проверка обновления сервера',
  'server.update-install': 'Установка обновления сервера',
  'server.rollback': 'Откат сервера на предыдущую версию',
}
const DETAIL_LABEL: Record<string, string> = { decision: 'решение', id: '№', days: 'дней', reason: 'причина', paidUntil: 'до', percent: 'доля', enabled: 'включена', status: 'статус', comment: 'комментарий', min: 'мин', max: 'макс', rows: 'строк', sessions: 'сессий', messages: 'сообщений', from: 'с', to: 'по', provider: 'способ', plan: 'тариф', q: 'поиск', regions: 'регионы', payment: 'оплата', targeted: 'получателей', images: 'фото', questions: 'вопросов', kind: 'вид', seen: 'увидели', closed: 'закрыли' }

const VALUE_LABEL: Record<string, string> = { open: 'открыт', closed: 'закрыт', approve: 'начислить', cancel: 'не засчитывать', paid: 'выплачено', rejected: 'отклонено', pending: 'ожидает', succeeded: 'оплачен', canceled: 'отменён', all: 'все', unpaid: 'без оплаты', cis: 'СНГ', europe: 'Европа', other: 'другие', none: 'не указана', announcement: 'объявление', survey: 'опрос' }

function detailText(details: Record<string, unknown> | undefined) {
  if (!details) return ''
  return Object.entries(details).map(([key, value]) => {
    const text = typeof value === 'boolean' ? (value ? 'да' : 'нет') : key === 'paidUntil' && typeof value === 'string' ? dateTime.format(new Date(value)) : key === 'status' || key === 'decision' || key === 'payment' || key === 'kind' ? VALUE_LABEL[String(value)] ?? String(value) : key === 'regions' ? String(value).split(',').map((part) => VALUE_LABEL[part] ?? part).join(', ') : String(value)
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
