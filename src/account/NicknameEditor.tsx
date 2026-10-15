import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Pencil, X } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { setTypedNickname, useLogAccounts } from './logNickname'
import { useAccountNickname } from './useAccountNickname'
import { useLocale } from '../i18n/LocaleProvider'
import { modeResetName } from '../state/modeReset'
import { confirmedNickname } from './nicknameChange'
import type { RaidMode } from '../domain/types'
import '../styles/gameLogs.css'

/**
 * The nickname comes by itself (owner, 13.10.2026: «при старте не нужно вводить ник»): from Tarkov.dev in the background
 * and from the game's «Выбор профиля и режима» and traders' screens (account/logNickname.ts). Typing it stays as the last
 * resort — «Указать вручную» while none is known, «Сменить ник» to correct one. One nickname for PvP, PvE and «Сезон»,
 * bound to the game account of each mode the logs of this PC show.
 */
export function NicknameEditor() {
  const nickname = useAccountNickname()
  const state = useAppState()
  const accounts = useLogAccounts()
  const { locale } = useLocale()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) input.current?.focus() }, [editing])

  if (nickname && !editing) {
    return (
      <button type="button" className="button small" onClick={() => { setValue(nickname); setError(''); setEditing(true) }}>
        <Pencil size={13} aria-hidden="true" />{uiLabel('Сменить ник')}
      </button>
    )
  }
  if (!editing) {
    return (
      <div className="nickname-editor-wait">
        <small className="nickname-editor-note">{uiLabel('Ник и уровень появятся сами: запустите игру — Raid OS прочитает их с экрана «Выбор профиля и режима».')}</small>
        <button type="button" className="button small ghost" onClick={() => { setValue(''); setError(''); setEditing(true) }}>
          <Pencil size={13} aria-hidden="true" />{uiLabel('Указать вручную')}
        </button>
      </div>
    )
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await setTypedNickname(value, () => state)
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }
  const fromLogs = Object.values(accounts).some(Boolean)
  return (
    <form className="nickname-editor" onSubmit={(event) => void save(event)}>
      <div className="nickname-editor-row">
        <label>
          <span>{uiLabel('Ник в игре')}</span>
          <input ref={input} className="input" value={value} maxLength={15} spellCheck={false} autoComplete="off" placeholder="Nickname" onChange={(event) => setValue(event.target.value)} />
        </label>
        <button type="submit" className="button small primary" disabled={saving || !value.trim()}>
          {saving ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{uiLabel('Сохранить ник')}
        </button>
        <button type="button" className="button small ghost" onClick={() => setEditing(false)}><X size={13} aria-hidden="true" />{uiLabel('Отмена')}</button>
      </div>
      {error && <small className="nickname-editor-error" role="alert">{uiLabel(error)}</small>}
      <small className="nickname-editor-note">{uiLabel(fromLogs ? 'Один ник для PvP, PvE и Сезона, как в игре. Он привяжется к аккаунту игры из логов этого компьютера.' : 'Один ник для PvP, PvE и Сезона, как в игре.')}</small>
      {/* Another nickname resets the mode shown (src/account/nicknameChange.ts); its other modes keep their progress. */}
      {confirmedNickname() && <small className="nickname-editor-note nickname-editor-warning">{nicknameResetNote(state.raidMode, locale)}</small>}
    </form>
  )
}

/** Under «Сменить ник»: a new nickname resets the mode the app shows, the other modes keep theirs. */
function nicknameResetNote(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? `A new nickname resets all ${name} progress. Other modes keep theirs.`
    : `Новый ник сбросит весь прогресс режима ${name}. Другие режимы сохранятся.`
}
