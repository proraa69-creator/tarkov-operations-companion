import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, LayoutGrid, LoaderCircle, Monitor, RotateCcw, Save, Smartphone, Undo2 } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { FIXED_BLOCKS, moveBlock, type OverviewZoneId } from '../overview/overviewLayout'
import { movePhoneBlock } from '../overview/phoneLayout'
import { blockLabel, isBuiltInOverview, OVERVIEW_BLOCKS, OVERVIEW_TITLE_MAX, sanitizeOverviewDefaults, type OverviewDefaults } from '../overview/overviewDefaults'
import { setOverviewDefaults } from '../overview/overviewDefaultsStore'
import { AdminMapBosses } from './AdminMapBosses'
import { bodyOf, draftOf, OVERVIEW_DEFAULTS_PATH, type BlocksDraft } from './blocksDraft'
import type { AdminRequest } from './ownerAccess'

const ZONES: Array<{ zone: OverviewZoneId; label: string }> = [
  { zone: 'stats', label: 'Карточки сверху' },
  { zone: 'rows', label: 'Строки страницы' },
  { zone: 'left', label: 'Левая (широкая) колонка' },
  { zone: 'right', label: 'Правая колонка' },
]
const ROW_LABEL: Record<string, string> = { stats: 'Карточки сверху', columns: 'Две колонки' }

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

/**
 * «Блоки» (owner, 16.10.2026: «функции редактирования блоков… логический конструктор»): the Overview every player starts
 * from — which blocks show, their default order on the PC and the phone and the owner's own headings (RU / EN). Saved on
 * the server (server/src/routes/overviewDefaults.ts) and shown by every app within a few minutes, without an update; a
 * player's own «Настроить блоки» order still wins, hidden blocks are hidden for everybody. Also the bosses standing in the
 * «План рейда» card on each map (AdminMapBosses.tsx).
 */
export function AdminBlocksSection({ request }: { request: AdminRequest }) {
  const [saved, setSaved] = useState<OverviewDefaults | null | undefined>(undefined)
  const [draft, setDraft] = useState<BlocksDraft>(() => draftOf(null))
  const [view, setView] = useState<'pc' | 'phone'>('pc')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let alive = true
    void request('GET', OVERVIEW_DEFAULTS_PATH).then((answer) => {
      if (!alive) return
      const value = sanitizeOverviewDefaults((answer as { defaults?: unknown } | null)?.defaults)
      setSaved(value)
      setDraft(draftOf(value))
    }).catch((reason: unknown) => { if (alive) { setSaved(null); setError(errorText(reason)) } })
    return () => { alive = false }
  }, [request])

  const changed = useMemo(() => JSON.stringify(bodyOf(draft)) !== JSON.stringify(bodyOf(draftOf(saved))), [draft, saved])
  const builtIn = isBuiltInOverview(sanitizeOverviewDefaults(bodyOf(draft)))
  const hidden = new Set(draft.hidden)
  const edit = (patch: Partial<BlocksDraft>) => { setDraft((current) => ({ ...current, ...patch })); setDone('') }
  const setTitle = (id: string, lang: 'ru' | 'en', text: string) => {
    const title = { ru: draft.titles[id]?.ru ?? '', en: draft.titles[id]?.en ?? '', [lang]: text.slice(0, OVERVIEW_TITLE_MAX) }
    edit({ titles: { ...draft.titles, [id]: title } })
  }
  const toggleHidden = (id: string) => edit({ hidden: hidden.has(id) ? draft.hidden.filter((other) => other !== id) : [...draft.hidden, id] })

  const run = async (action: () => Promise<OverviewDefaults | null>, message: string) => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      const next = await action()
      setSaved(next)
      setDraft(draftOf(next))
      // This app shows it at once; the players' apps with their next check of the notice.
      setOverviewDefaults(next)
      setDone(message)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const save = () => run(async () => {
    if (builtIn) {
      await request('POST', `${OVERVIEW_DEFAULTS_PATH}/reset`, {})
      return null
    }
    const answer = await request('PUT', OVERVIEW_DEFAULTS_PATH, bodyOf(draft)) as { defaults?: unknown } | null
    const value = sanitizeOverviewDefaults(answer?.defaults)
    if (!value) throw new Error('Сервер недоступен')
    return value
  }, 'Сохранено. Игроки увидят новый «Обзор» в течение нескольких минут.')
  const reset = () => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(uiLabel('Вернуть всем стандартный «Обзор»? Ваши названия, порядок блоков и боссы на картах удалятся.'))) return
    void run(async () => { await request('POST', `${OVERVIEW_DEFAULTS_PATH}/reset`, {}); return null }, 'Всем возвращён стандартный «Обзор».')
  }

  const moveButtons = (label: string, canUp: boolean, canDown: boolean, onMove: (step: -1 | 1) => void) => (
    <span className="admin-move">
      <button type="button" className="icon-button small" disabled={!canUp || busy} onClick={() => onMove(-1)} aria-label={`${uiLabel(label)}: ${uiLabel('выше')}`} title={uiLabel('Выше')}><ArrowUp size={14} /></button>
      <button type="button" className="icon-button small" disabled={!canDown || busy} onClick={() => onMove(1)} aria-label={`${uiLabel(label)}: ${uiLabel('ниже')}`} title={uiLabel('Ниже')}><ArrowDown size={14} /></button>
    </span>
  )
  const name = (id: string) => draft.titles[id]?.ru?.trim() || uiLabel(blockLabel(id))

  return (
    <section className="panel admin-section" aria-labelledby="admin-blocks-title">
      <div className="panel-header">
        <div><div className="eyebrow">{uiLabel('«Обзор» для всех игроков')}</div><div className="panel-title" id="admin-blocks-title">{uiLabel('Блоки')}</div></div>
        <LayoutGrid size={18} className="brass" aria-hidden="true" />
      </div>
      <div className="panel-body admin-blocks">
        <p className="dim">{uiLabel('Какие блоки видны, их порядок и названия. Игрок, который сам настроил блоки, сохраняет свой порядок; скрытые блоки скрыты у всех.')}</p>
        {saved === undefined && !error && <small className="dim">{uiLabel('Загрузка с сервера…')}</small>}

        <div className="admin-subhead">{uiLabel('Видимость и названия')}</div>
        <div className="admin-blocks-table" role="table" aria-label={uiLabel('Видимость и названия')}>
          <div className="admin-blocks-row is-head" role="row">
            <span role="columnheader">{uiLabel('Блок')}</span><span role="columnheader">{uiLabel('Показывать')}</span><span role="columnheader">{uiLabel('Название (RU)')}</span><span role="columnheader">{uiLabel('Название (EN)')}</span>
          </div>
          {OVERVIEW_BLOCKS.map(({ id, label }) => (
            <div key={id} className={`admin-blocks-row${hidden.has(id) ? ' is-hidden' : ''}`} role="row">
              <span role="cell" className="admin-blocks-name">{uiLabel(label)}</span>
              <span role="cell"><label className="admin-check"><input type="checkbox" checked={!hidden.has(id)} disabled={busy} onChange={() => toggleHidden(id)} aria-label={`${uiLabel(label)}: ${uiLabel('показывать')}`} />{uiLabel(hidden.has(id) ? 'скрыт' : 'виден')}</label></span>
              <span role="cell"><input className="input" value={draft.titles[id]?.ru ?? ''} maxLength={OVERVIEW_TITLE_MAX} placeholder={label} disabled={busy} onChange={(event) => setTitle(id, 'ru', event.target.value)} aria-label={`${uiLabel(label)}: ${uiLabel('название (RU)')}`} /></span>
              <span role="cell"><input className="input" lang="en" value={draft.titles[id]?.en ?? ''} maxLength={OVERVIEW_TITLE_MAX} placeholder={uiText(label)} disabled={busy} onChange={(event) => setTitle(id, 'en', event.target.value)} aria-label={`${uiLabel(label)}: ${uiLabel('название (EN)')}`} /></span>
            </div>
          ))}
        </div>
        <small className="dim">{uiLabel('Пустое название — стандартное. Английское видят игроки с английским интерфейсом.')}</small>

        <div className="admin-subhead">{uiLabel('Порядок по умолчанию')}</div>
        <div className="segmented-filter admin-blocks-view" role="tablist" aria-label={uiLabel('Порядок по умолчанию')}>
          <button type="button" role="tab" aria-selected={view === 'pc'} className={view === 'pc' ? 'active' : ''} onClick={() => setView('pc')}><Monitor size={13} aria-hidden="true" /> {uiLabel('ПК')}</button>
          <button type="button" role="tab" aria-selected={view === 'phone'} className={view === 'phone' ? 'active' : ''} onClick={() => setView('phone')}><Smartphone size={13} aria-hidden="true" /> {uiLabel('Телефон')}</button>
        </div>
        {view === 'pc' ? (
          <div className="admin-zones">
            {ZONES.map(({ zone, label }) => (
              <div key={zone} className="admin-zone">
                <div className="eyebrow">{uiLabel(label)}</div>
                <ol className="admin-order" aria-label={uiLabel(label)}>
                  {draft.layout[zone].map((id, index, list) => (
                    <li key={id} className={`${hidden.has(id) ? 'is-hidden' : ''}${FIXED_BLOCKS.has(id) ? ' is-fixed' : ''}`}>
                      <span>{FIXED_BLOCKS.has(id) ? uiLabel(ROW_LABEL[id] ?? id) : name(id)}{hidden.has(id) && <small className="dim"> · {uiLabel('скрыт')}</small>}</span>
                      {!FIXED_BLOCKS.has(id) && moveButtons(FIXED_BLOCKS.has(id) ? id : blockLabel(id), index > 0, index < list.length - 1, (step) => edit({ layout: moveBlock(draft.layout, zone, id, index + step) }))}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          <ol className="admin-order admin-phone-order" aria-label={uiLabel('Телефон')}>
            {draft.phone.map((id, index, list) => (
              <li key={id} className={hidden.has(id) ? 'is-hidden' : ''}>
                <span>{name(id)}{hidden.has(id) && <small className="dim"> · {uiLabel('скрыт')}</small>}</span>
                {moveButtons(blockLabel(id), index > 0, index < list.length - 1, (step) => edit({ phone: movePhoneBlock({ order: draft.phone, narrow: [] }, id, step).order }))}
              </li>
            ))}
          </ol>
        )}

        <div className="admin-subhead">{uiLabel('Боссы в блоке «План рейда»')}</div>
        <p className="dim">{uiLabel('Какие боссы стоят на карте рейда в «Обзоре», в каких режимах и в каком порядке: сверху вниз — слева направо в карточке.')}</p>
        <AdminMapBosses value={draft.bosses} disabled={busy} onChange={(bosses) => edit({ bosses })} />

        <div className="admin-row admin-blocks-actions">
          <button type="button" className="button small primary" disabled={busy || !changed} onClick={() => void save()}>
            {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}{uiLabel('Сохранить для всех')}
          </button>
          <button type="button" className="button small ghost" disabled={busy || !changed} onClick={() => { setDraft(draftOf(saved)); setDone('') }}><Undo2 size={13} aria-hidden="true" />{uiLabel('Отменить правки')}</button>
          <button type="button" className="button small ghost" disabled={busy || !saved} onClick={reset}><RotateCcw size={13} aria-hidden="true" />{uiLabel('Стандартный «Обзор» для всех')}</button>
        </div>
        {done && <small className="admin-done" role="status">{uiLabel(done)}</small>}
        {error && <p className="owner-notices-error" role="alert">{uiLabel(/Не найдено|Неизвестный запрос/.test(error) ? 'Раздел доступен только аккаунту владельца на обновлённом сервере.' : error)}</p>}
      </div>
    </section>
  )
}
