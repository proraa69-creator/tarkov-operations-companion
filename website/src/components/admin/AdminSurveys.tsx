import { useCallback, useMemo, useState } from 'react'
import { ClipboardList, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { countryName } from '../../../../src/shared/countries'
import { audienceText, REGION_NAMES, type NoticeRegion, type SurveyQuestion } from '../../../../src/shared/notices'
import type { OwnerNoticeView } from '../../../../src/notices/OwnerNoticeTools'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, failure, numberFormat, useAdminData, type Failure } from './adminData'
import { ownerCall, surveyCsv } from './noticesApi'
import { WriteToUser } from './WriteToUser'

/** GET /v1/accounts/me/admin/surveys/:id/results (server/src/services/noticeStore.ts results). */
export interface SurveyResults {
  survey: OwnerNoticeView
  questions: Array<{
    id: string
    type: SurveyQuestion['type']
    text: string
    answered: number
    options?: Array<{ id: string; text: string; count: number; percent: number }>
    answers?: Array<{ text: string; email: string | null; createdAt: string }>
  }>
  responses: Array<{ accountId: string; email: string | null; country?: string; countryOther?: string; region: NoticeRegion | 'none'; createdAt: string; answers: Record<string, string[] | string> }>
}

/**
 * «Опросы» (owner, 15.10.2026: «эту статистику я могу посмотреть потом на сайте, указывается почта того кто прошел опрос,
 * и я могу после этого с ними связаться»): every survey with its number of answers; the chosen one with counts and shares
 * per option (bars), the free answers, and a table of the answers with the respondent's e-mail, date, country and region —
 * filtered by region and e-mail, exported as CSV, with «Написать» to the respondent (the support chat).
 */
export function AdminSurveys() {
  const [params, setParams] = useSearchParams()
  const list = useAdminData(useCallback((token: string) => ownerCall<{ notices: OwnerNoticeView[] }>(token, 'GET', '/v1/accounts/me/admin/notices?kind=survey'), []))
  const surveys = list.data?.notices ?? []
  const requested = Number(params.get('survey'))
  const selected = surveys.find((item) => item.id === requested)?.id ?? surveys[0]?.id
  const choose = (id: number) => setParams({ tab: 'surveys', survey: String(id) }, { replace: true })

  return (
    <section className="panel owner-panel" aria-labelledby="admin-surveys-title">
      <div className="panel-header">
        <div className="panel-title" id="admin-surveys-title"><ClipboardList aria-hidden="true" />Опросы</div>
        <button type="button" className="button ghost small" disabled={list.loading} onClick={() => void list.refresh()}>{list.loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить</button>
      </div>
      <div className="panel-body owner-body">
        {list.error && <Notice tone={list.error.offline ? 'offline' : 'error'}>{list.error.message}</Notice>}
        {!list.data && !list.error && <Loading />}
        {list.data && !surveys.length && <p className="muted" style={{ margin: 0 }}>Опросов пока нет — создайте первый во вкладке «Объявления» или в приложении владельца.</p>}
        {surveys.length > 0 && (
          <div className="admin-survey-picker" role="tablist" aria-label="Опросы">
            {surveys.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={item.id === selected} className={`admin-survey-tab${item.id === selected ? ' is-active' : ''}`} onClick={() => choose(item.id)}>
                <strong>{item.title}</strong>
                <span>{dateTime.format(new Date(item.createdAt))} · ответов: {numberFormat.format(item.responses ?? 0)}{item.withdrawnAt ? ' · отозван' : ''}</span>
              </button>
            ))}
          </div>
        )}
        {selected !== undefined && <SurveyResultsView key={selected} id={selected} />}
      </div>
    </section>
  )
}

function SurveyResultsView({ id }: { id: number }) {
  const results = useAdminData(useCallback((token: string) => ownerCall<SurveyResults>(token, 'GET', `/v1/accounts/me/admin/surveys/${id}/results`), [id]))
  const [region, setRegion] = useState<NoticeRegion | 'none' | 'all'>('all')
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const data = results.data
  const rows = useMemo(() => (data?.responses ?? []).filter((response) => (region === 'all' || response.region === region) && (!query.trim() || (response.email ?? '').toLowerCase().includes(query.trim().toLowerCase()))), [data, region, query])

  const exportCsv = async () => {
    if (!results.token) return
    setExporting(true)
    setError(null)
    try {
      const blob = await surveyCsv(results.token, id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `raidos-survey-${id}.csv`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (reason) {
      setError(failure(reason))
    } finally {
      setExporting(false)
    }
  }

  if (results.error) return <Notice tone={results.error.offline ? 'offline' : 'error'}>{results.error.message}</Notice>
  if (!data) return <Loading text="Загружаем ответы…" />
  const questions = data.survey.questions ?? []
  const answerText = (question: SurveyQuestion, answer: string[] | string | undefined) => (answer === undefined ? '—' : typeof answer === 'string' ? answer : answer.map((option) => question.options?.find((item) => item.id === option)?.text ?? option).join(', '))
  return (
    <div className="admin-survey">
      <div className="stat-grid owner-stats">
        <div className="stat-card"><div className="stat-label">Ответов</div><div className="stat-value mono">{numberFormat.format(data.responses.length)}</div><div className="stat-meta">из {numberFormat.format(data.survey.targeted)} получателей</div></div>
        <div className="stat-card"><div className="stat-label">Увидели</div><div className="stat-value mono">{numberFormat.format(data.survey.seen)}</div><div className="stat-meta">{audienceText(data.survey.audience)}</div></div>
      </div>
      <ol className="admin-survey-questions">
        {data.questions.map((question, index) => (
          <li key={question.id} className="admin-survey-question">
            <div className="field-label">{index + 1}. {question.text} <span className="muted">· ответили {numberFormat.format(question.answered)}</span></div>
            {question.options ? (
              <ul className="admin-survey-bars">
                {question.options.map((option) => (
                  <li key={option.id}>
                    <span className="admin-survey-bar-label">{option.text}</span>
                    <span className="admin-survey-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, option.percent)}%` }} /></span>
                    <span className="admin-survey-bar-value mono">{numberFormat.format(option.count)} · {option.percent.toLocaleString('ru-RU')} %</span>
                  </li>
                ))}
              </ul>
            ) : (question.answers?.length
              ? <ul className="admin-survey-texts">{question.answers.map((answer, at) => <li key={at}><span>{answer.text}</span><small className="muted">{answer.email ?? 'аккаунт удалён'} · {dateTime.format(new Date(answer.createdAt))}</small></li>)}</ul>
              : <span className="muted">Ответов пока нет.</span>)}
          </li>
        ))}
      </ol>
      <div className="admin-survey-filters">
        <label className="field-label">Регион
          <select className="input" value={region} onChange={(event) => setRegion(event.target.value as NoticeRegion | 'none' | 'all')}>
            <option value="all">Все</option>
            {(Object.keys(REGION_NAMES) as NoticeRegion[]).map((item) => <option key={item} value={item}>{REGION_NAMES[item]}</option>)}<option value="none">Не указана</option>
          </select>
        </label>
        <label className="field-label">E-mail
          <input className="input" type="search" value={query} placeholder="Поиск по почте" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="button small" disabled={exporting || !data.responses.length} onClick={() => void exportCsv()}>{exporting ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}Выгрузить CSV</button>
      </div>
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      <div className="table-scroll">
        <table className="pay-table admin-survey-table">
          <caption className="visually-hidden">Ответы на опрос</caption>
          <thead>
            <tr><th scope="col">Дата</th><th scope="col">E-mail</th><th scope="col">Страна</th>{questions.map((question, index) => <th key={question.id} scope="col">{index + 1}. {question.text}</th>)}<th scope="col"><span className="visually-hidden">Действия</span></th></tr>
          </thead>
          <tbody>
            {rows.map((response) => (
              <tr key={response.accountId}>
                <td className="mono">{dateTime.format(new Date(response.createdAt))}</td>
                <td className="admin-email">{response.email ?? <span className="muted">аккаунт удалён</span>}</td>
                <td>{response.countryOther ? `«${response.countryOther}»` : response.country ? countryName(response.country, 'ru') : '—'} <span className="muted">· {response.region === 'none' ? 'Не указана' : REGION_NAMES[response.region]}</span></td>
                {questions.map((question) => <td key={question.id} className="admin-wrap">{answerText(question, response.answers[question.id])}</td>)}
                <td>{response.email && <WriteToUser accountId={response.accountId} email={response.email} />}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={questions.length + 4} className="muted">{data.responses.length ? 'Под фильтр никто не подходит.' : 'Ответов пока нет.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
