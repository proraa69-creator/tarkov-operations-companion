import { CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api, type LavaEvent } from '../../api'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, failure, PLAN_LABEL, useAdminData, type Failure } from './adminData'

/** What each webhook result means and what the owner does about it (docs/lava-troubleshooting.md has the long version). */
const RESULTS: Record<string, { label: string; tone: string; text: string }> = {
  paid: { label: 'Оплачено', tone: 'green', text: 'Всё в порядке: Lava.top сообщила об оплате, подписка выдана.' },
  renewed: { label: 'Продление', tone: 'green', text: 'Автопродление: Lava.top списала деньги за следующий период, подписка продлена.' },
  unauthorized: { label: 'Нет доступа (401)', tone: 'danger', text: 'Кто-то постучался в вебхук без верного ключа, ничего не применено. Если это Lava.top: ключ вебхука в приложении не совпадает с ключом в кабинете Lava.top или выбран другой тип авторизации. Сверьте ключ и тип (X-Api-Key или Basic), сохраните и перезапустите сервер. Если Lava.top не настроена на этом сервере, ответ всегда 401. Повторы за минуту склеены в одну строку (число в скобках).' },
  'bad-request': { label: 'Непонятное тело', tone: 'danger', text: 'Ключ верный, но тело запроса не похоже на событие Lava.top. Проверьте в кабинете Lava.top, что вебхук настроен именно на события оплаты.' },
  ignored: { label: 'Пропущено', tone: '', text: 'Событие Lava.top, которое нам не нужно (например, возврат) или без номера контракта. Ничего не сделано, ответ 200. Если оплата не пришла, а здесь только такие события, напишите в поддержку Lava.top, какие события они шлют.' },
  duplicate: { label: 'Повтор', tone: '', text: 'Такое событие уже приходило, повторная доставка пропущена. Это нормально: Lava.top повторяет доставку. Если первое событие было «сумма не совпала», выдать подписку можно кнопкой в его строке.' },
  'not-ours': { label: 'Не наш платёж', tone: 'danger', text: 'Ключ верный, но у нас нет счёта с таким номером контракта. Возможные причины: платёж создан не через сайт Raid OS (а по ссылке на продукт в Lava.top), вебхук приходит на другой сервер/другую базу, или базу сервера сбросили. Найдите платёж в кабинете Lava.top и выдайте подписку вручную (карточка пользователя → «Выдать подписку»).' },
  'amount-mismatch': { label: 'Сумма не совпала', tone: 'danger', text: 'Lava.top сообщила об оплате, но сумма или валюта отличается от счёта (или сумму счёта мы не знаем). Подписка НЕ выдана. Откройте платёж в кабинете Lava.top: если он настоящий и оплачен, нажмите «Подтвердить и выдать подписку» — будет выдан тариф из счёта.' },
  'already-applied': { label: 'Уже применён', tone: '', text: 'Платёж по этому счёту уже был обработан раньше (оплачен или отменён). Повторно ничего не выдано.' },
  failed: { label: 'Оплата не прошла', tone: '', text: 'Lava.top сообщила, что оплата не прошла (карта отклонена и т.п.). Счёт отменён. Подписка не выдавалась, делать ничего не нужно.' },
  'renewal-failed': { label: 'Продление не прошло', tone: '', text: 'Lava.top не смогла списать деньги за продление. Она повторит попытку сама; подписка продлится, когда списание пройдёт.' },
  cancelled: { label: 'Подписка отменена', tone: '', text: 'Покупатель или Lava.top отменили автопродление. Оплаченный период сохраняется до конца.' },
  error: { label: 'Ошибка сервера', tone: 'danger', text: 'Сервер не смог обработать событие и ответил 500, Lava.top повторит доставку позже. Если повторяется, посмотрите журнал сервера (строка «Lava.top webhook error») и напишите разработчику.' },
}

const AUTH: Record<LavaEvent['authMethod'], string> = { none: 'без ключа', 'api-key': 'X-Api-Key', basic: 'Basic' }
const money = (value?: { amount?: number; currency?: string }) => (value ? `${value.amount === undefined ? '?' : value.amount.toFixed(2)} ${value.currency ?? ''}`.trim() : '—')
const age = (minutes: number) => (minutes < 60 ? `${minutes} мин` : minutes < 48 * 60 ? `${Math.floor(minutes / 60)} ч` : `${Math.floor(minutes / 1440)} дн`)

/** «События Lava.top»: the last 100 webhook calls with explanations, invoices that were never confirmed, and the owner's confirmation of an amount mismatch. */
export function AdminLavaEvents() {
  const fetcher = useCallback((token: string) => api.adminLavaEvents(token), [])
  const view = useAdminData(fetcher)
  const [busy, setBusy] = useState<number | null>(null)
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const data = view.data

  const confirm = async (event: LavaEvent) => {
    const text = `Подтвердить платёж ${event.contract ? `…${event.contract}` : ''}: получено ${money(event.got)}, в счёте ${money(event.expected)}?\n\nНажимайте, только если вы проверили в кабинете Lava.top, что платёж настоящий и оплачен. Будет выдан тариф из счёта; сумма из уведомления запишется как оплата.`
    if (!view.token || !window.confirm(text)) return
    setBusy(event.id); setError(null); setDone(null)
    try {
      const result = await api.adminLavaConfirm(view.token, event.id)
      view.setData(result)
      setDone({ ok: true, text: result.already ? 'Этот платёж уже был подтверждён или обработан — повторно ничего не выдано.' : 'Подписка выдана, платёж отмечен оплаченным.' })
    } catch (reason) {
      setError(failure(reason))
    } finally {
      setBusy(null)
    }
  }

  return (
    <details className="admin-section" open>
      <summary className="field-label">События Lava.top</summary>
      <div className="admin-stack">
        <div className="admin-totals">
          <span className="field-hint">Каждое обращение Lava.top к вебхуку — что пришло и чем кончилось. Показаны последние 100.</span>
          <button type="button" className="button small ghost" onClick={() => void view.refresh()} disabled={view.loading}><RefreshCw aria-hidden="true" className={view.loading ? 'spinner' : undefined} />Обновить</button>
        </div>
        {view.error && <Notice tone={view.error.offline ? 'offline' : 'error'}>{view.error.message}</Notice>}
        {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
        {done && <Notice tone="success">{done.text}</Notice>}
        {!data && !view.error && <Loading text="Загружаем события…" />}
        {data && !data.configured && <Notice tone="error">Lava.top на сервере не подключена (нет ключей): любое обращение к вебхуку получает 401. Задайте ключи в приложении: «Оплата: другие страны (Lava.top)».</Notice>}
        {data && (
          <>
            <h3 className="field-label">Начатые, но не подтверждённые счета ({data.pending.length})</h3>
            {data.pending.length === 0 ? <div className="muted admin-empty">Таких счетов нет.</div> : (
              <div className="table-scroll">
                <table className="pay-table admin-table">
                  <thead><tr><th scope="col">Создан</th><th scope="col">Возраст</th><th scope="col">E-mail</th><th scope="col">Тариф</th><th scope="col">Контракт</th><th scope="col" className="num">Сумма счёта</th></tr></thead>
                  <tbody>
                    {data.pending.map((item) => (
                      <tr key={item.paymentId}>
                        <td className="mono">{dateTime.format(new Date(item.createdAt))}</td>
                        <td className="mono">{age(item.ageMinutes)}</td>
                        <td className="admin-email" title={item.paymentId}>{item.email}</td>
                        <td>{PLAN_LABEL[item.plan] ?? item.plan}</td>
                        <td className="mono">{item.contract ? `…${item.contract}` : '—'}</td>
                        <td className="num mono">{item.expected ? money(item.expected) : 'неизвестна'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="field-hint">Счёт «ждёт» либо пока покупатель не оплатил (закрыл страницу), либо уведомление не дошло. Если человек уверяет, что заплатил, проверьте платёж в кабинете Lava.top и журнал доставки вебхука (см. docs/lava-troubleshooting.md).</p>

            <h3 className="field-label">Обращения к вебхуку ({data.events.length})</h3>
            {data.events.length === 0 ? <div className="muted admin-empty">Lava.top ещё ни разу не обращалась к вебхуку. Если оплата была — уведомления не доходят: проверьте адрес вебхука и журнал доставки в кабинете Lava.top.</div> : (
              <div className="table-scroll">
                <table className="pay-table admin-table">
                  <thead><tr><th scope="col">Время</th><th scope="col">Результат</th><th scope="col">Событие</th><th scope="col">Контракт</th><th scope="col">Пришло</th><th scope="col">В счёте</th><th scope="col">Ключ</th><th scope="col">Что это значит</th></tr></thead>
                  <tbody>
                    {data.events.map((event) => {
                      const info = RESULTS[event.result] ?? { label: event.result, tone: '', text: 'Неизвестный результат.' }
                      return (
                        <tr key={event.id}>
                          <td className="mono">{dateTime.format(new Date(event.lastAt))}</td>
                          <td><span className={`tag ${info.tone}`}>{info.label}</span>{event.count > 1 ? <span className="dim mono"> ×{event.count}</span> : null}</td>
                          <td className="mono">{event.eventType ?? '—'}</td>
                          <td className="mono">{event.contract ? `…${event.contract}` : '—'}</td>
                          <td className="mono">{money(event.got)}</td>
                          <td className="mono">{money(event.expected)}</td>
                          <td>{AUTH[event.authMethod]}</td>
                          <td>
                            <span className="field-hint">{info.text}</span>
                            {event.confirmable && (
                              <div><button type="button" className="button small primary" disabled={busy !== null} onClick={() => void confirm(event)}>{busy === event.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}Подтвердить и выдать подписку</button></div>
                            )}
                            {event.confirmedAt && <div className="field-hint">Подтверждено владельцем {dateTime.format(new Date(event.confirmedAt))}.</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  )
}
