import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Pencil, X } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { setTypedNickname, useLogAccounts } from './logNickname'
import { useAccountNickname } from './useAccountNickname'
import '../styles/gameLogs.css'

/**
 * «Сменить ник» and the first nickname (owner, 13.10.2026: «делай ручной ввод, не обращаясь к тарков дев», «возвращай
 * кнопку сменить ник»): the player types the nickname, nothing is looked up. It is one for PvP, PvE and «Сезон» and is
 * bound to the game account of each mode the logs of this PC show (account/logNickname.ts).
 */
export function NicknameEditor() {
  const nickname = useAccountNickname()
  const state = useAppState()
  const accounts = useLogAccounts()
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
        {editing && <button type="button" className="button small ghost" onClick={() => setEditing(false)}><X size={13} aria-hidden="true" />{uiLabel('Отмена')}</button>}
      </div>
      {error && <small className="nickname-editor-error" role="alert">{uiLabel(error)}</small>}
      <small className="nickname-editor-note">{uiLabel(fromLogs ? 'Один ник для PvP, PvE и Сезона, как в игре. Он привяжется к аккаунту игры из логов этого компьютера.' : 'Один ник для PvP, PvE и Сезона, как в игре.')}</small>
    </form>
  )
}
