/* eslint-disable react-refresh/only-export-components */
import { useState, type KeyboardEvent } from 'react'
import { Check, LoaderCircle, RotateCcw } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { cleanIpcError } from '../sync/serverSync'
import { findQuestText, QUEST_NAME_MAX_LENGTH, QUEST_TEXT_MAX_LENGTH, useQuestTextOverrides, useQuestTextWriter, type QuestTextField, type QuestTextOverride } from '../data/questTextOverrides'
import type { Quest } from '../domain/types'

/** One editable text of a quest: which field, its current text (with the owner's corrections) and a label. */
export interface QuestTextSpec { field: QuestTextField; target: string; label: string; value: string; multiline: boolean }

/**
 * What the quest window lets the owner edit: the quest's title; a story chapter's shown stage (title and task) and the chapter's
 * description; a trader quest's description and every objective line (the «Цели» of the window and the text of the
 * objective's map points).
 */
export function questTextFields(quest: Quest, stageIndex: number | null): QuestTextSpec[] {
  const stage = stageIndex != null ? quest.stages?.[stageIndex] : undefined
  const name: QuestTextSpec = { field: 'name', target: '', label: 'Название квеста', value: quest.name, multiline: false }
  if (stage && stageIndex != null) {
    return [
      name,
      { field: 'stage-title', target: String(stageIndex), label: `Этап ${stageIndex + 1}: заголовок`, value: stage.title, multiline: false },
      { field: 'stage-description', target: String(stageIndex), label: `Этап ${stageIndex + 1}: задача`, value: stage.description ?? '', multiline: true },
      { field: 'description', target: '', label: 'Описание главы (страница «Задания»)', value: quest.description, multiline: true },
    ]
  }
  const objectives: QuestTextSpec[] = quest.objectiveDetails?.length
    ? quest.objectiveDetails.map((objective, index) => ({ field: 'objective', target: objective.id, label: `Цель ${index + 1}`, value: objective.description, multiline: true }))
    : (quest.objectiveIds ?? []).flatMap((id, index): QuestTextSpec[] => (id ? [{ field: 'objective', target: id, label: `Цель ${index + 1}`, value: quest.objectives[index] ?? '', multiline: true }] : []))
  return [name, { field: 'description', target: '', label: 'Описание квеста (страница «Задания»)', value: quest.description, multiline: true }, ...objectives]
}

/**
 * The quest constructor's text editing in the quest window at the bottom of the map (owner app; owner, 13.10.2026: «в
 * нижнем окне квеста могу редактировать описание»). A saved text is on every player's screen at once
 * (src/data/questTextOverrides.ts); it replaces the text of the interface language the owner is using.
 */
export function QuestTextEditor({ quest, stageIndex }: { quest: Quest; stageIndex: number | null }) {
  const { locale } = useLocale()
  const lang = locale === 'en' ? 'en' : 'ru'
  const overrides = useQuestTextOverrides(true)
  const writer = useQuestTextWriter()
  return (
    <div className="quest-text-editor">
      <h4>{uiText('Текст квеста')} · {lang === 'en' ? 'English' : 'русский'}</h4>
      <small className="dim">{uiText('Исправленный текст сохраняется на сервере и сразу виден всем игрокам на этом языке.')}</small>
      {questTextFields(quest, stageIndex).map((spec) => {
        const override = findQuestText(overrides, quest.id, spec.field, spec.target, lang)
        return (
          <QuestTextRow
            key={`${quest.id}|${spec.field}|${spec.target}|${lang}`}
            spec={spec}
            override={override}
            onSave={(text) => writer.save({ questId: quest.id, field: spec.field, target: spec.target, lang, text })}
            onReset={override ? () => writer.reset(override.id) : undefined}
          />
        )
      })}
    </div>
  )
}

/**
 * One text field of the quest constructor: «Сохранить», «Отменить», «Вернуть исходный». `onClose`: the in-place editor
 * of the quest window (components/QuestSheetEditing.tsx), closed after a save or with «Закрыть».
 */
export function QuestTextRow({ spec, override, onSave, onReset, onClose }: { spec: QuestTextSpec; override?: QuestTextOverride; onSave: (text: string) => Promise<void>; onReset?: () => Promise<void>; onClose?: () => void }) {
  const [base, setBase] = useState(spec.value)
  const [draft, setDraft] = useState(spec.value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // The text changed under the field (a saved correction, «Вернуть исходный», another language): an untouched field follows it.
  if (spec.value !== base) {
    setBase(spec.value)
    if (draft === base) setDraft(spec.value)
  }
  const text = draft.trim()
  const dirty = text !== spec.value.trim()
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setSaved(false)
    try { await action(); setSaved(true); onClose?.() } catch (reason) { setError(ownerTextError(reason)) } finally { setBusy(false) }
  }
  const maxLength = spec.field === 'name' ? QUEST_NAME_MAX_LENGTH : QUEST_TEXT_MAX_LENGTH
  const save = () => { if (text && dirty && !busy) void run(() => onSave(text)) }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || !spec.multiline)) { event.preventDefault(); save() }
  }
  // In place inside a line of the quest window (a heading, a paragraph): phrasing elements only.
  const Box = onClose ? 'span' : 'div'
  const id = `quest-text-${spec.field}-${spec.target || 'quest'}${onClose ? '-inline' : ''}`
  return (
    <Box className={`quest-text-row${override ? ' is-corrected' : ''}${onClose ? ' is-inline' : ''}`}>
      <label htmlFor={id}>
        {uiText(spec.label)}
        {override && <span className="tag brass">{uiText('исправлено вручную')}</span>}
      </label>
      {spec.multiline
        ? <textarea id={id} className="input" autoFocus={Boolean(onClose)} rows={Math.min(5, Math.max(2, Math.ceil(draft.length / 90)))} maxLength={maxLength} value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setSaved(false) }} onKeyDown={onKeyDown} />
        : <input id={id} className="input" autoFocus={Boolean(onClose)} maxLength={maxLength} value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setSaved(false) }} onKeyDown={onKeyDown} />}
      <Box className="quest-text-actions">
        {(dirty || busy) && (
          <button type="button" className="button small primary" disabled={busy || !text} onClick={save} title={uiText('Сохранить (Ctrl+Enter)')}>
            {busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{uiText('Сохранить')}
          </button>
        )}
        {dirty && !busy && <button type="button" className="button small ghost" onClick={() => { setDraft(spec.value); setError('') }}>{uiText('Отменить')}</button>}
        {onReset && !dirty && (
          <button type="button" className="button small ghost" disabled={busy} onClick={() => void run(onReset)} title={uiText('Вернуть текст из игры')}>
            <RotateCcw size={13} />{uiText('Вернуть исходный')}
          </button>
        )}
        {onClose && !busy && <button type="button" className="button small ghost" onClick={onClose}>{uiText('Закрыть')}</button>}
        {saved && !dirty && <small className="quest-text-saved">{uiText('Сохранено — видят все игроки')}</small>}
        {error && <small className="account-error">{uiText(error)}</small>}
      </Box>
    </Box>
  )
}

function ownerTextError(reason: unknown) {
  const message = cleanIpcError(reason)
  if (/Не найдено|Неизвестный запрос/.test(message)) return 'Править тексты квестов может только аккаунт владельца.'
  if (/Требуется вход|Сессия истекла/.test(message)) return 'Войдите в аккаунт владельца на сервере.'
  return message || 'Сервер недоступен'
}
