import { useMemo } from 'react'
import { BellRing } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { ACCOUNT_URL } from '../shared/links'
import { OwnerNoticeTools, SurveyResultsLink, type OwnerRequest } from './OwnerNoticeTools'

/** The website's «Опросы» tab of the admin panel: the statistics with the respondents' e-mails. */
export const SURVEY_RESULTS_URL = `${ACCOUNT_URL.replace(/\/cabinet\/?$/, '')}/admin?tab=surveys`

/**
 * The owner app: «Объявления по регионам» under «Баннер для всех» (owner, 15.10.2026: «я нажимаю в админ приложении
 * создать объявление, выбираю категорию по снг европе итд»): «Создать объявление» / «Создать опрос», the sent ones with
 * how many accounts they target, saw and closed them, and «Отозвать». A survey's statistics are on the website.
 */
export function OwnerNoticesPanel() {
  const serviceRequest = typeof window === 'undefined' ? undefined : window.tarkovDesktop?.serviceRequest
  const request = useMemo<OwnerRequest | undefined>(() => (serviceRequest ? async (method, path, body) => {
    const answer = await serviceRequest(method, path, body)
    if (answer === null) throw new Error('Войдите в аккаунт владельца в профиле')
    return answer
  } : undefined), [serviceRequest])
  if (!request) return null
  return (
    <section className="panel owner-announcement owner-notices-panel">
      <div className="panel-header">
        <div><div className="eyebrow">{uiLabel('Всплывающее окно у игроков')}</div><div className="panel-title">{uiLabel('Объявления по регионам')}</div></div>
        <BellRing size={18} className="brass" aria-hidden="true" />
      </div>
      <div className="panel-body">
        <p className="dim owner-notices-intro">{uiLabel('Окно появится у выбранных игроков при входе или в течение минуты, если приложение открыто. Во время рейда ждёт его конца.')}</p>
        <OwnerNoticeTools request={request} t={uiLabel} results={() => <SurveyResultsLink href={SURVEY_RESULTS_URL} t={uiLabel} />} />
      </div>
    </section>
  )
}
