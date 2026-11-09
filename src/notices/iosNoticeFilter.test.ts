import { describe, expect, it } from 'vitest'
import type { PlayerNotice, PlayerSurvey } from '../shared/notices'
import { noticeWithoutPayment, surveyWithoutPayment } from './iosNoticeFilter'

/** The iPhone app says nothing about paying (owner, 09.11.2026): such notices and surveys stay on the PC app and the site. */
const notice = (fields: Partial<PlayerNotice>) => ({ id: 1, kind: 'notice', title: 'Карта обновлена', text: 'Новые точки на Таможне.', createdAt: '2026-11-09T00:00:00Z', ...fields }) as PlayerNotice
const survey = (fields: Partial<PlayerSurvey>) => ({ id: 2, kind: 'survey', title: 'Как вам карты?', questions: [], laterLeft: 3, createdAt: '2026-11-09T00:00:00Z', ...fields }) as PlayerSurvey

describe('notices on the iPhone', () => {
  it('keeps news, reports and game events', () => {
    expect(noticeWithoutPayment(notice({}))).toBe(true)
    expect(noticeWithoutPayment(notice({ title: 'Заявка №12 взята в работу', text: 'Карта: неверная точка', titleEn: 'Report #12 is in work' }))).toBe(true)
    expect(noticeWithoutPayment(notice({ button: { text: 'Открыть', url: 'https://raidos.app/download' } }))).toBe(true)
    expect(surveyWithoutPayment(survey({}))).toBe(true)
    expect(noticeWithoutPayment(notice({ title: 'Новая платформа', text: 'Raid OS для ПК обновлён' }))).toBe(true)
  })

  it('drops free or credited days, plans, prices, discounts and links to paying', () => {
    expect(noticeWithoutPayment(notice({ title: 'Вам зачислено 2 дня пробного периода', text: 'Отсчёт начнётся с первого рейда.' }))).toBe(false)
    expect(noticeWithoutPayment(notice({ title: 'Вам зачислено 3 дня за отчёт', text: 'Спасибо!', titleEn: '3 days added for your report' }))).toBe(false)
    expect(noticeWithoutPayment(notice({ title: 'Скидка 20 % на год', text: 'Только до пятницы' }))).toBe(false)
    expect(noticeWithoutPayment(notice({ title: 'Новость', text: 'Обновление', titleEn: 'Subscription renewed' }))).toBe(false)
    expect(noticeWithoutPayment(notice({ button: { text: 'Открыть', url: 'https://raidos.app/cabinet#subscription' } }))).toBe(false)
    expect(surveyWithoutPayment(survey({ title: 'Сколько вы готовы платить?' }))).toBe(false)
    expect(surveyWithoutPayment(survey({ introEn: 'Help us choose the price' }))).toBe(false)
  })
})
