import { SURVEY_LIMITS, type SurveyQuestion } from '../shared/notices'
import type { DraftQuestion } from './OwnerNoticeTools'

/** What a question still lacks before sending (the server checks the same), or ''. */
export function questionProblem(question: SurveyQuestion, answer: string[] | string | undefined) {
  if (question.type === 'text') {
    const text = typeof answer === 'string' ? answer.trim() : ''
    if (question.required && !text) return 'Ответ обязателен'
    if (text.length > SURVEY_LIMITS.answer) return 'Не длиннее 1000 символов'
    return ''
  }
  const chosen = Array.isArray(answer) ? answer : []
  if (question.required && !chosen.length) return 'Выберите вариант'
  if (question.type === 'multiple' && question.max && chosen.length > question.max) return 'Слишком много вариантов'
  return ''
}

/** What the builder still lacks before «Опубликовать» (the server checks the same), or ''. */
export function surveyDraftProblem(title: string, questions: DraftQuestion[]) {
  if (!title.trim()) return 'Введите название опроса'
  if (!questions.length) return 'Добавьте хотя бы один вопрос'
  for (const [index, question] of questions.entries()) {
    if (!question.text.trim()) return `Вопрос ${index + 1}: введите текст`
    if (question.type === 'text') continue
    const filled = question.options.filter((option) => option.text.trim())
    if (filled.length < SURVEY_LIMITS.options.min) return `Вопрос ${index + 1}: нужно минимум ${SURVEY_LIMITS.options.min} варианта`
    const max = Number(question.max)
    if (question.type === 'multiple' && question.max && (!Number.isInteger(max) || max < 1 || max > filled.length)) return `Вопрос ${index + 1}: «не больше» — от 1 до ${filled.length}`
  }
  return ''
}
