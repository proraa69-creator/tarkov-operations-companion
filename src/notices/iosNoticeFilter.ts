import type { PlayerNotice, PlayerSurvey } from '../shared/notices'

/**
 * The iPhone app says nothing about paying (owner, 09.11.2026: «чтобы в приложении не было упоминаний об оплате»): the
 * server's notices and surveys that speak of payments, plans, prices, discounts, free or credited days stay off it — the
 * same account sees them in the PC app and on the site. Everything else (reports taken in work, news, game events) shows.
 */
const PAYMENT_WORDS = /оплат|плат(?!форм)|подписк|пробн|тариф|скидк|зачислен|премиум|руб|₽|\$|€|premium|subscri|trial|pay|price|plan|discount|credited|days? added|refund/i

const words = (...values: Array<string | undefined>) => values.filter(Boolean).join('\n')

export function noticeWithoutPayment(notice: PlayerNotice) {
  return !PAYMENT_WORDS.test(words(notice.title, notice.text, notice.titleEn, notice.textEn, notice.button?.text, notice.button?.textEn))
    && !/cabinet|pay|bezebee|yookassa/i.test(notice.button?.url ?? '')
}

export function surveyWithoutPayment(survey: PlayerSurvey) {
  return !PAYMENT_WORDS.test(JSON.stringify({ title: survey.title, titleEn: survey.titleEn, intro: survey.intro, introEn: survey.introEn, questions: survey.questions }))
}
