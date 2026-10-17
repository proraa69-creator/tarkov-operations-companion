import { useId, useState, type FormEvent } from 'react'
import { ClipboardList, LoaderCircle, ShieldCheck } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { cleanIpcError } from '../sync/serverSync'
import { localized, SURVEY_LIMITS, type PlayerSurvey, type SurveyAnswers, type SurveyQuestion } from '../shared/notices'
import { questionProblem } from './surveyRules'
import { answerSurvey } from './noticeInbox'

/**
 * The owner's survey as a window over the app (owner, 15.10.2026: «создавать опросы … эту статистику я могу посмотреть
 * потом на сайте, указывается почта того кто прошел опрос»): every question on one scrollable form, in the app's language
 * where the owner wrote it. «Отправить» sends it once for the account (the server keeps a second answer out); «Позже»
 * puts it off until the next start of the app (SURVEY_LATER_MAX times at most). The window says that the answers go to
 * Raid OS with the account's e-mail.
 */
export function SurveyPopup({ survey, locale, onLater }: { survey: PlayerSurvey; locale: 'ru' | 'en'; onLater: () => void }) {
  const id = useId()
  const [answers, setAnswers] = useState<SurveyAnswers>({})
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = Object.fromEntries(survey.questions.map((question) => [question.id, questionProblem(question, answers[question.id])]))
  const valid = Object.values(problems).every((problem) => !problem)

  const toggle = (question: SurveyQuestion, option: string) => setAnswers((current) => {
    if (question.type === 'single') return { ...current, [question.id]: [option] }
    const chosen = Array.isArray(current[question.id]) ? current[question.id] as string[] : []
    return { ...current, [question.id]: chosen.includes(option) ? chosen.filter((item) => item !== option) : [...chosen, option] }
  })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setChecked(true)
    if (!valid || busy) return
    setBusy(true)
    setError('')
    try {
      const sent: SurveyAnswers = {}
      for (const question of survey.questions) {
        const answer = answers[question.id]
        if (typeof answer === 'string' ? answer.trim() : answer?.length) sent[question.id] = typeof answer === 'string' ? answer.trim() : answer!
      }
      await answerSurvey(survey.id, sent)
    } catch (reason) {
      const message = cleanIpcError(reason)
      // Answered on another device meanwhile: nothing more to send.
      if (/уже ответили/.test(message)) { onLater(); return }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const title = localized(survey.title, survey.titleEn, locale)
  const intro = survey.intro ? localized(survey.intro, survey.introEn, locale) : ''
  return (
    <div className="registration-overlay notice-overlay" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
      <form className="panel registration-dialog notice-dialog survey-dialog" onSubmit={(event) => void submit(event)} noValidate>
        <div className="notice-head">
          <div className="registration-icon notice-icon"><ClipboardList size={22} aria-hidden="true" /></div>
          <div className="eyebrow">{uiLabel('Опрос Raid OS')}</div>
        </div>
        <h2 id={`${id}-title`}>{title}</h2>
        {intro && <p className="notice-text">{intro}</p>}
        <p className="survey-privacy"><ShieldCheck size={14} aria-hidden="true" />{uiLabel('Ответы видит администрация Raid OS вместе с почтой вашего аккаунта.')}</p>
        <ol className="survey-questions">
          {survey.questions.map((question, index) => {
            const problem = checked ? problems[question.id] : ''
            const text = `${index + 1}. ${localized(question.text, question.textEn, locale)}`
            const hint = question.type === 'multiple' ? (question.max ? `${uiLabel('Можно выбрать несколько, не больше')} ${question.max}` : uiLabel('Можно выбрать несколько')) : ''
            return (
              <li key={question.id} className={`survey-question${problem ? ' is-invalid' : ''}`}>
                {question.type === 'text' ? (
                  <label className="field-label">
                    <span className="survey-question-title">{text}{question.required && <span className="survey-required" aria-hidden="true"> *</span>}</span>
                    <textarea className="input" maxLength={SURVEY_LIMITS.answer} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} disabled={busy}
                      aria-required={question.required || undefined} aria-invalid={Boolean(problem) || undefined}
                      onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
                    <small>{(typeof answers[question.id] === 'string' ? (answers[question.id] as string).length : 0)}/{SURVEY_LIMITS.answer}</small>
                  </label>
                ) : (
                  <fieldset aria-required={question.required || undefined} aria-invalid={Boolean(problem) || undefined}>
                    <legend>{text}{question.required && <span className="survey-required" aria-hidden="true"> *</span>}</legend>
                    {hint && <small>{hint}</small>}
                    {(question.options ?? []).map((option) => {
                      const chosen = Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(option.id)
                      return (
                        <label key={option.id} className="survey-choice">
                          <input type={question.type === 'single' ? 'radio' : 'checkbox'} name={`${id}-${question.id}`} checked={chosen} disabled={busy} onChange={() => toggle(question, option.id)} />
                          <span>{localized(option.text, option.textEn, locale)}</span>
                        </label>
                      )
                    })}
                  </fieldset>
                )}
                {problem && <small className="account-error" role="alert">{uiLabel(problem)}</small>}
              </li>
            )
          })}
        </ol>
        {error && <p className="account-error" role="alert">{uiLabel(error)}</p>}
        <div className="notice-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={onLater}>{uiLabel('Позже')}</button>
          <button type="submit" className="button primary" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{uiLabel('Отправить')}</button>
        </div>
      </form>
    </div>
  )
}
