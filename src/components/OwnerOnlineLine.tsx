import { uiText } from '../i18n/renderText'
import { isOwnerApp } from '../app/buildEdition'
import { useOwnerOnline } from '../data/ownerOnline'

/**
 * «Онлайн сейчас: N» right under «Ваши предложения» in the owner app's sidebar (owner, 14.10.2026): the accounts in the
 * PC or phone app within the last few minutes, and how many of them on each (src/data/ownerOnline.ts). Players' apps
 * render nothing and never ask.
 */
export function OwnerOnlineLine() {
  if (!isOwnerApp()) return null
  return <OnlineLine />
}

function OnlineLine() {
  const online = useOwnerOnline()
  if (!online) return null
  const title = uiText(`Аккаунты в приложении для ПК или телефона за последние ${online.windowMinutes} мин.`)
  return (
    <div className="nav-online" role="status" title={title} aria-label={`${uiText(`Онлайн сейчас: ${online.online}`)} · ${title}`}>
      <span className="nav-online-dot" aria-hidden="true" />
      <span className="nav-online-text">
        <span className="nav-online-count">{uiText(`Онлайн сейчас: ${online.online}`)}</span>
        <span className="nav-online-split">{uiText(`ПК ${online.pc} · телефон ${online.phone}`)}</span>
      </span>
      <strong className="nav-online-short" aria-hidden="true">{online.online}</strong>
    </div>
  )
}
