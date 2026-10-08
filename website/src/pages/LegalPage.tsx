import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, type PlansResponse } from '../api'
import { LEGAL_DOCUMENTS, LEGAL_VERSION_LABEL, legalDocument, SELLER_DETAILS } from '../legal/documents'
import { formatMoney, PLAN_LABELS, visiblePlans } from '../plans'
import '../extras.css'

function LegalNav({ current }: { current?: string }) {
  return (
    <nav className="legal-nav" aria-label="Документы">
      <Link to="/legal" className={!current ? 'active' : undefined}>Тарифы, оплата и возврат</Link>
      {LEGAL_DOCUMENTS.map((doc) => <Link key={doc.slug} to={`/legal/${doc.slug}`} className={current === doc.slug ? 'active' : undefined}>{doc.short}</Link>)}
    </nav>
  )
}

/** /legal — the buyer's page (tariffs, payment, access, refund, contacts, seller); /legal/:slug — one document. */
export function LegalPage() {
  const { slug } = useParams()
  if (!slug) return <BuyerInfo />
  const doc = legalDocument(slug)
  if (!doc) return <Navigate to="/legal" replace />
  return (
    <div className="page page-in">
      <div className="container narrow legal">
        <div className="eyebrow">Документы</div>
        <h1 className="page-title">{doc.title}</h1>
        <p className="page-subtitle">Редакция от {LEGAL_VERSION_LABEL}</p>
        <LegalNav current={doc.slug} />
        <article className="panel legal-doc">
          {doc.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((text) => <p key={text}>{text}</p>)}
              {section.items && <ul>{section.items.map((text) => <li key={text}>{text}</li>)}</ul>}
            </section>
          ))}
          {doc.slug === 'offer' && <SellerDetails title="14. Реквизиты Исполнителя" />}
        </article>
      </div>
    </div>
  )
}

/**
 * Everything Robokassa checks on the site before connecting it (its letter of 2026-10-07): the service and what it
 * gives, prices, ordering, payment, how the service is provided, refusal and refund step by step, contacts, the
 * seller's full name and INN, the documents. Prices come from the server, with the cabinet's grid as the fallback.
 */
function BuyerInfo() {
  const [plans, setPlans] = useState<PlansResponse | null>(null)
  useEffect(() => {
    let cancelled = false
    api.plans().then((next) => { if (!cancelled) setPlans(next) }, () => undefined)
    return () => { cancelled = true }
  }, [])
  const shown = visiblePlans(plans)

  return (
    <div className="page page-in">
      <div className="container narrow legal">
        <div className="eyebrow">Покупателям</div>
        <h1 className="page-title">Тарифы, оплата и возврат</h1>
        <p className="page-subtitle">Что входит в подписку, сколько она стоит, как оплатить и получить доступ, как отказаться и вернуть деньги.</p>
        <LegalNav />
        <article className="panel legal-doc">
          <section id="service">
            <h2>Что вы покупаете</h2>
            <p>Подписка Raid OS — доступ на оплаченный срок к приложению-помощнику для игры Escape from Tarkov. Без подписки в приложении доступны только вход в аккаунт и оформление подписки.</p>
            <ul>
              <li>Интерактивные карты всех локаций: выходы, переходы, точки заданий, ключи и двери, этажи зданий.</li>
              <li>Трекер заданий торговцев и сюжетных глав: прогресс подхватывается из логов игры на вашем компьютере.</li>
              <li>Требуемые предметы для рейда: что взять с собой под текущие задания.</li>
              <li>Отдельный прогресс для PvP, PvE и «Сезона».</li>
              <li>Мини-карта поверх окна игры и приоритет карт.</li>
              <li>Предметы для «Коллекционера» и задания для Каппы, справочник предметов и цен.</li>
              <li>Синхронизация прогресса между приложением для Windows, мобильным приложением и сайтом.</li>
            </ul>
            <p>Для приложения на компьютере нужна Windows 10 или 11 (64-бит). Приложение не вмешивается в игру, не автоматизирует игровой процесс и не обходит её защиту.</p>
          </section>

          <section id="prices">
            <h2>Тарифы и цены</h2>
            <div className="table-scroll">
              <table className="pay-table legal-prices">
                <thead><tr><th scope="col">Срок доступа</th><th scope="col">Цена</th><th scope="col">В пересчёте на месяц</th></tr></thead>
                <tbody>
                  {shown.map((plan) => (
                    <tr key={plan.id}>
                      <td>{PLAN_LABELS[plan.id]}{plan.discountPercent > 0 && <span className="tag brass tag-mini">−{plan.discountPercent} %</span>}</td>
                      <td className="mono">{plan.price === null ? '—' : formatMoney(plan.price, plan.currency)}</td>
                      <td className="mono">{plan.price === null ? '—' : formatMoney(Math.round(plan.price / plan.months), plan.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>Цены в рублях. Один месяц — 30 дней. Каждая оплата разовая: автоматических повторных списаний нет.</p>
          </section>

          <section id="order">
            <h2>Как оформить подписку</h2>
            <ol>
              <li>Зарегистрируйтесь на сайте по e-mail — после регистрации откроется личный кабинет.</li>
              <li>В <Link to="/cabinet">личном кабинете</Link>, в разделе «Подписка», выберите срок.</li>
              <li>Отметьте согласие с <Link to="/legal/offer">офертой</Link> и перейдите к оплате.</li>
            </ol>
          </section>

          <section id="payment">
            <h2>Оплата</h2>
            <p>Оплата в рублях на защищённой странице платёжного сервиса Robokassa: банковская карта, СБП и другие способы, доступные на странице оплаты. Данные карты вводятся только на стороне Robokassa — сайт их не получает и не хранит. Чек приходит на e-mail аккаунта из приложения «Мой налог».</p>
          </section>

          <section id="access">
            <h2>Получение доступа</h2>
            <p>Услуга оказывается в электронном виде, без доставки. Доступ открывается в вашем аккаунте автоматически сразу после подтверждения оплаты — обычно за несколько минут. Войдите под тем же e-mail в <Link to="/download">приложение для Windows</Link>, мобильное приложение или на сайт.</p>
            <p>Если доступ не открылся в течение 24 часов после оплаты, напишите на raidosapp@gmail.com — откроем доступ или вернём всю сумму.</p>
          </section>

          <section id="refund">
            <h2>Отказ от подписки и возврат денег</h2>
            <p>Отказаться можно в любой момент — до открытия доступа или в процессе пользования.</p>
            <ul>
              <li>Доступ ещё не открыт или не открылся по нашей вине — возвращаем всю сумму.</li>
              <li>Отказ в процессе пользования — возвращаем стоимость неиспользованных полных дней: цена тарифа ÷ число дней тарифа × число оставшихся полных дней.</li>
              <li>Комиссии платёжного сервиса и банка из суммы возврата не удерживаются.</li>
            </ul>
            <h3>Как вернуть деньги</h3>
            <ol>
              <li>Напишите на <a href="mailto:raidosapp@gmail.com?subject=%D0%92%D0%BE%D0%B7%D0%B2%D1%80%D0%B0%D1%82">raidosapp@gmail.com</a> с e-mail вашего аккаунта, тема письма — «Возврат». Укажите дату и сумму оплаты.</li>
              <li>В течение 3 рабочих дней мы подтвердим получение заявления и сообщим сумму возврата.</li>
              <li>Деньги вернутся через Robokassa тем же способом, на ту же карту или счёт, в течение 10 календарных дней с даты получения заявления. Срок зачисления зависит от вашего банка.</li>
              <li>В день возврата доступ к подписке прекращается, чек в «Мой налог» корректируется.</li>
            </ol>
            <p>Полные условия — в разделе 8 <Link to="/legal/offer">публичной оферты</Link>.</p>
          </section>

          <section id="contacts">
            <h2>Контакты</h2>
            <ul>
              <li>E-mail для вопросов, заявлений и претензий: <a href="mailto:raidosapp@gmail.com">raidosapp@gmail.com</a>. Отвечаем в течение 10 календарных дней, обычно быстрее.</li>
              <li>Telegram: <a href="https://t.me/shauuuurma" target="_blank" rel="noreferrer">@shauuuurma</a></li>
            </ul>
          </section>

          <SellerDetails title="Продавец" />

          <section id="documents">
            <h2>Документы</h2>
            <ul>
              {LEGAL_DOCUMENTS.map((doc) => <li key={doc.slug}><Link to={`/legal/${doc.slug}`}>{doc.title}</Link></li>)}
            </ul>
          </section>
        </article>
      </div>
    </div>
  )
}

function SellerDetails({ title }: { title: string }) {
  return (
    <section id="seller">
      <h2>{title}</h2>
      <dl className="legal-details">
        {SELLER_DETAILS.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>
  )
}
