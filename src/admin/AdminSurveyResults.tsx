import { useState } from 'react'
import { BarChart3, LoaderCircle } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import type { AdminRequest } from './ownerAccess'
import { SurveyResultsLink } from '../notices/OwnerNoticeTools'
import { ACCOUNT_URL } from '../shared/links'

/** The website's «Опросы» tab of the admin panel: the statistics with the respondents' e-mails. */
export const SURVEY_RESULTS_URL = `${ACCOUNT_URL.replace(/\/cabinet\/?$/, '')}/admin?tab=surveys`

/** GET /v1/accounts/me/admin/surveys/:id/results, the part shown here (server/src/services/noticeStore.ts results). */
interface Results {
  questions: Array<{ id: string; text: string; answered: number; options?: Array<{ id: string; text: string; count: number; percent: number }>; answers?: Array<{ text: string }> }>
  responses: unknown[]
}

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

/**
 * «Результаты» of a survey in «Админ панель» → «Опросы»: the answers per option with their share and the free answers,
 * right in the app; the website keeps the full table with the respondents' e-mails («Подробно на сайте»).
 */
export function AdminSurveyResults({ id, request }: { id: number; request: AdminRequest }) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Results | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setBusy(true)
    setError('')
    try {
      const answer = await request('GET', `/v1/accounts/me/admin/surveys/${id}/results`) as Results | null
      if (!answer || !Array.isArray(answer.questions)) throw new Error('Сервер недоступен')
      setResults(answer)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className={`button small ${open ? 'primary' : 'ghost'}`} aria-expanded={open} onClick={() => void toggle()}>
        {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <BarChart3 size={13} aria-hidden="true" />}{uiLabel('Результаты')}
      </button>
      <SurveyResultsLink href={SURVEY_RESULTS_URL} t={uiLabel} />
      {open && (
        <div className="admin-survey-results" role="region" aria-label={uiLabel('Результаты опроса')}>
          {error && <p className="owner-notices-error" role="alert">{uiLabel(error)}</p>}
          {results && <p className="dim">{uiLabel('Ответов')}: <b>{results.responses.length}</b></p>}
          {results?.questions.map((question, index) => (
            <div key={question.id} className="admin-survey-question">
              <strong>{index + 1}. {question.text}</strong> <small className="dim">· {uiLabel('ответили')} {question.answered}</small>
              {question.options ? (
                <ul className="admin-survey-bars">
                  {question.options.map((option) => (
                    <li key={option.id}>
                      <span>{option.text}</span>
                      <span className="admin-survey-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, option.percent))}%` }} /></span>
                      <span className="mono">{option.count} · {option.percent} %</span>
                    </li>
                  ))}
                </ul>
              ) : question.answers?.length
                ? <ul className="admin-survey-texts">{question.answers.slice(0, 20).map((answer, at) => <li key={at}>{answer.text}</li>)}</ul>
                : <small className="dim">{uiLabel('Ответов пока нет.')}</small>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
