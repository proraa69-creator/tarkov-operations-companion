import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { uiText } from '../i18n/renderText'

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  return (
    <div className="squad-copy">
      <span className="squad-copy-label">{label}</span>
      <code className="squad-copy-value">{value}</code>
      <button type="button" className="button small ghost" onClick={copy} aria-label={uiText('Скопировать')}>{copied ? <Check size={14} /> : <Copy size={14} />}{uiText(copied ? 'Скопировано' : 'Скопировать')}</button>
    </div>
  )
}

/** Small round avatar with the first letter of the name; a distinct hue per member position. */
export function MemberAvatar({ name, index }: { name: string; index: number }) {
  return <span className={`squad-avatar hue-${index % 5}`} aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
}

export function MemberChips({ ids, names }: { ids: string[]; names: Map<string, { label: string; index: number }> }) {
  return (
    <span className="squad-chips">
      {ids.map((id) => {
        const entry = names.get(id)
        return <span key={id} className={`squad-chip hue-${(entry?.index ?? 0) % 5}`}>{entry?.label ?? '—'}</span>
      })}
    </span>
  )
}

export function ErrorLine({ message }: { message: string }) {
  if (!message) return null
  return <p className="squad-error" role="alert">{uiText(message)}</p>
}
