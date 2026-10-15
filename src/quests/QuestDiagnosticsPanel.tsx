import { useMemo, useState } from 'react'
import { Activity, ChevronDown } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useLocale } from '../i18n/LocaleProvider'
import { isOwnerApp } from '../app/buildEdition'
import { useLogStatus } from '../import/logStatus'
import { useAppState } from '../state/AppState'
import { diagnosticsLine, withInferred, type QuestConflictKind, type QuestSourceKind } from './questEngine'
import { questAvailabilityOf, questResolutionOf } from './questReadModel'
import { resolveMode } from './questInputs'
import './questDiagnostics.css'

const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']
const SOURCE_NAMES: Record<QuestSourceKind, { ru: string; en: string }> = {
  log: { ru: 'логи этого ПК', en: 'this PC\'s logs' },
  server: { ru: 'сервер (другие ПК)', en: 'server (other PCs)' },
  manual: { ru: 'вручную', en: 'manual' },
  table: { ru: 'экран «Задания»', en: 'Tasks screen' },
  story: { ru: 'экран сюжета', en: 'story screen' },
  legacy: { ru: 'старые ручные', en: 'legacy manual' },
}
const CONFLICT_NAMES: Record<QuestConflictKind, { ru: string; en: string }> = {
  'screen-vs-log': { ru: 'экран против логов', en: 'screen vs logs' },
  'manual-overridden': { ru: 'ручная отметка старше логов', en: 'manual mark older than logs' },
  'before-floor': { ru: 'до сброса режима', en: 'before the mode reset' },
  'table-outside-pve': { ru: 'экран «Задания» не в PvE', en: 'Tasks screen outside PvE' },
  'table-completed-unproven': { ru: '«выполнено» с экрана без подтверждения', en: 'unproven screen completion' },
  'prerequisite-open': { ru: 'выполнено, а предыдущее не сдано', en: 'completed while a prerequisite is open' },
  'unknown-quest': { ru: 'нет в каталоге', en: 'not in the catalog' },
}
const VIA = { quest: { ru: 'квест взят снова после сдачи', en: 'a quest taken again after its hand-in' }, prestige: { ru: 'запрос престижа', en: 'the prestige request' }, 'profile-create': { ru: 'новый профиль', en: 'a new profile' } } as const
const MARKER = { prestige: { ru: 'Престиж +', en: 'Prestige +' }, wipe: { ru: 'Вайп', en: 'Wipe' }, nickname: { ru: 'новый ник', en: 'new nickname' } } as const
const when = (iso: string, locale: 'ru' | 'en') => new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'ru-RU')
const modeName = (mode: RaidMode, locale: 'ru' | 'en') => mode === 'pvp' ? 'PvP' : mode === 'pve' ? 'PvE' : locale === 'en' ? 'Season' : 'Сезон'

/**
 * «Диагностика квестов» (owner only, src/pages/ProfilePage.tsx): per mode what each source of the quest-state engine
 * (src/quests/questEngine.ts) contributed, what inference would add (never counted) and every conflict — so a count like
 * «226 вместо 154» is explained at a glance. Collapsed until opened; computed only then.
 */
export function QuestDiagnosticsPanel() {
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  // Players never see it (the players' app and the phone are the 'client' edition).
  if (!isOwnerApp()) return null
  return (
    <section className="panel quest-diagnostics" data-testid="quest-diagnostics">
      <button type="button" className="panel-header quest-diagnostics-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div><div className="eyebrow">{locale === 'en' ? 'Owner only' : 'Только для владельца'}</div><div className="panel-title">{locale === 'en' ? 'Quest diagnostics' : 'Диагностика квестов'}</div></div>
        <span className="quest-diagnostics-icons"><Activity size={16} aria-hidden="true" /><ChevronDown size={16} aria-hidden="true" className={open ? 'is-open' : undefined} /></span>
      </button>
      {open && <QuestDiagnosticsBody locale={locale} />}
    </section>
  )
}

function QuestDiagnosticsBody({ locale }: { locale: 'ru' | 'en' }) {
  const { data } = useTarkovData()
  const { activeProfile, raidMode } = useAppState()
  const scan = useLogStatus().scan
  const rows = useMemo(() => MODES.map((mode) => {
    const progress = activeProfile.modes[mode]
    // The catalog loaded is the mode shown's (one at a time): its checks and the lists' inference for that mode only.
    const shown = mode === raidMode
    const resolution = shown ? questResolutionOf(progress, mode, data.quests) : resolveMode(progress, mode)
    const diagnostics = shown ? withInferred(resolution.diagnostics, questAvailabilityOf(data.quests, progress)) : resolution.diagnostics
    const conflicts = [...resolution.states.values()].flatMap((state) => state.conflicts.filter((conflict) => conflict.kind !== 'before-floor').map((conflict) => ({ taskId: state.taskId, decided: state.source, ...conflict }))).slice(0, 12)
    return { mode, diagnostics, conflicts, marker: progress.resetMarker, summary: scan?.identityOnly ? undefined : scan?.summaryByMode?.[mode] }
  }), [activeProfile.modes, data.quests, raidMode, scan])
  const name = (taskId: string) => data.quests.find((quest) => quest.id === taskId)?.name ?? taskId
  return (
    <div className="panel-body quest-diagnostics-body">
      {rows.map(({ mode, diagnostics, conflicts, marker, summary }) => (
        <article key={mode} className={`quest-diagnostics-mode${mode === raidMode ? ' is-shown' : ''}`} data-mode={mode}>
          <header><strong>{modeName(mode, locale)}</strong><span>{diagnosticsLine(diagnostics, locale)}</span></header>
          <dl>
            {(Object.keys(SOURCE_NAMES) as QuestSourceKind[]).map((source) => {
              const decided = diagnostics.decided[source]
              const total = decided.completed + decided.active + decided.failed
              if (!total && !diagnostics.layerSizes[source]) return null
              return <div key={source}><dt>{SOURCE_NAMES[source][locale]}</dt><dd>{locale === 'en'
                ? `${decided.completed} completed · ${decided.active} active · ${decided.failed} failed (${diagnostics.layerSizes[source]} read)`
                : `${decided.completed} выполн. · ${decided.active} текущ. · ${decided.failed} провал. (прочитано ${diagnostics.layerSizes[source]})`}</dd></div>
            })}
            <div><dt>{locale === 'en' ? 'Counted «Completed»' : 'Считается «Выполнено»'}</dt><dd>{diagnostics.completed}</dd></div>
            {diagnostics.floor && <div><dt>{locale === 'en' ? 'Game reset (logs)' : 'Сброс в игре (журналы)'}</dt><dd>{when(diagnostics.floor, locale)}{summary?.resetVia ? ` · ${VIA[summary.resetVia][locale]}` : ''} · {locale === 'en' ? `${diagnostics.beforeFloor} older ignored` : `старше не учтено: ${diagnostics.beforeFloor}`}</dd></div>}
            {marker && <div><dt>{locale === 'en' ? `«${MARKER[marker.kind].en}» pressed` : `Нажато «${MARKER[marker.kind].ru}»`}</dt><dd>{when(marker.at, locale)} · {marker.resolvedAt ? (locale === 'en' ? `confirmed by the logs ${when(marker.resolvedAt, locale)}` : `подтверждено журналами ${when(marker.resolvedAt, locale)}`) : (locale === 'en' ? 'waiting for the game\'s reset in the logs' : 'ждём сброса в журналах игры')}</dd></div>}
            {(Object.keys(diagnostics.conflicts) as QuestConflictKind[]).filter((kind) => kind !== 'before-floor').map((kind) => <div key={kind}><dt>{CONFLICT_NAMES[kind][locale]}</dt><dd>{diagnostics.conflicts[kind]}</dd></div>)}
          </dl>
          {conflicts.length > 0 && <ul className="quest-diagnostics-conflicts">
            {conflicts.map((conflict, index) => <li key={`${conflict.taskId}-${conflict.kind}-${index}`}>
              <b>{name(conflict.taskId)}</b> · {CONFLICT_NAMES[conflict.kind][locale]}{conflict.status ? ` (${SOURCE_NAMES[conflict.source][locale]}: ${conflict.status}${conflict.detail ? ` / ${conflict.detail}` : ''})` : ''}
            </li>)}
          </ul>}
        </article>
      ))}
    </div>
  )
}

