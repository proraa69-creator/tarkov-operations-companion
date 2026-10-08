import { FileText, Receipt, ScrollText, ShieldCheck } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { LEGAL_DOCUMENTS, LEGAL_VERSION_LABEL, legalDocument, SELLER_DETAILS } from '../legal/documents'
import '../extras.css'

/** Text with [placeholders] highlighted, so the owner sees at once what to fill in. */
export function WithPlaceholders({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g)
  return <>{parts.map((part, i) => (part.startsWith('[') && part.endsWith(']') ? <mark key={i} className="ph">{part}</mark> : part))}</>
}

function DraftNotice() {
  return (
    <div className="legal-draft" role="note">
      <strong>Черновик — проверить у юриста перед публикацией.</strong>
      <span>Данные в <mark className="ph">[квадратных скобках]</mark> заполняет владелец сервиса. Редакция от {LEGAL_VERSION_LABEL}.</span>
    </div>
  )
}

function LegalNav({ current }: { current?: string }) {
  return (
    <nav className="legal-nav" aria-label="Документы">
      <Link to="/legal" className={!current ? 'active' : undefined}>Реквизиты и оплата</Link>
      {LEGAL_DOCUMENTS.map((doc) => <Link key={doc.slug} to={`/legal/${doc.slug}`} className={current === doc.slug ? 'active' : undefined}>{doc.short}</Link>)}
    </nav>
  )
}

/** /legal — documents, seller details, payment and receipts; /legal/:slug — one document. */
export function LegalPage() {
  const { slug } = useParams()
  if (slug) {
    const doc = legalDocument(slug)
    if (!doc) return <Navigate to="/legal" replace />
    return (
      <div className="page page-in">
        <div className="container narrow legal">
          <div className="eyebrow">Документы</div>
          <h1 className="page-title">{doc.title}</h1>
          <p className="page-subtitle">Редакция от {LEGAL_VERSION_LABEL}</p>
          <DraftNotice />
          <LegalNav current={doc.slug} />
          <article className="panel legal-doc">
            {doc.sections.map((section) => (
              <section key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs?.map((text) => <p key={text}><WithPlaceholders text={text} /></p>)}
                {section.items && <ul>{section.items.map((text) => <li key={text}><WithPlaceholders text={text} /></li>)}</ul>}
              </section>
            ))}
            {doc.slug === 'offer' && <SellerDetails title="16. Реквизиты Исполнителя" />}
          </article>
        </div>
      </div>
    )
  }
  return (
    <div className="page page-in">
      <div className="container narrow legal">
        <div className="eyebrow">Документы</div>
        <h1 className="page-title">Реквизиты, оплата и документы</h1>
        <p className="page-subtitle">Кто продаёт подписку, как проходит оплата, куда приходит чек и как вернуть деньги.</p>
        <DraftNotice />
        <LegalNav />
        <div className="legal-cards">
          {LEGAL_DOCUMENTS.map((doc) => (
            <Link key={doc.slug} to={`/legal/${doc.slug}`} className="panel legal-card">
              {doc.slug === 'offer' ? <ScrollText aria-hidden="true" /> : doc.slug === 'cookies' ? <FileText aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              <strong>{doc.title}</strong>
              <span>{doc.summary}</span>
            </Link>
          ))}
        </div>
        <article className="panel legal-doc">
          <SellerDetails title="Продавец" />
          <section>
            <h2><Receipt size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 8, color: 'var(--brass)' }} />Оплата и чеки</h2>
            <ul>
              <li>Подписка оплачивается в личном кабинете: 1, 3, 6 или 12 месяцев. Цена в рублях указана на карточке тарифа.</li>
              <li>Оплата проходит на защищённой странице ЮKassa (ООО НКО «ЮМани»): банковская карта, СБП и другие способы. Данные карты сайт не получает.</li>
              <li>Каждая оплата — разовый платёж, без автопродления и повторных списаний.</li>
              <li>Чек НПД формируется в «Мой налог» (422-ФЗ) и направляется на e-mail аккаунта.</li>
              <li>Доступ открывается сразу после подтверждения платежа.</li>
            </ul>
          </section>
          <section>
            <h2>Возврат денег</h2>
            <p><WithPlaceholders text="Отказаться от подписки можно в любой момент: напишите на raidosapp@gmail.com с e-mail аккаунта. Вернём сумму за неиспользованные полные дни (подробнее — в разделе 10 оферты) тем же способом, которым вы платили, в течение 10 дней." /></p>
          </section>
        </article>
      </div>
    </div>
  )
}

function SellerDetails({ title }: { title: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <dl className="legal-details">
        {SELLER_DETAILS.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><WithPlaceholders text={value} /></dd></div>)}
      </dl>
    </section>
  )
}
