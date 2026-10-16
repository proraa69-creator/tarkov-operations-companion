import { Heart } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { DONATE_URL } from '../app/support'
import { BrandEmblem } from './BrandMark'
import '../styles/donate.css'

/**
 * «Поддержать проект» (owner, 13.10.2026, with the button's design): the app's emblem, «RAID OS», «Поддержать проект»,
 * «Помогите развивать компаньон для Escape from Tarkov», «Спасибо!». One card in every colour scheme: the panel, text and
 * accent come from the theme (styles/donate.css). Opens the donation page in the browser (electron/externalLinks.ts).
 */
export function DonateCard() {
  // One phrase in both languages; its first word plain, the rest in the accent («ПОДДЕРЖАТЬ / ПРОЕКТ»).
  const [first, ...rest] = uiText('Поддержать проект').split(' ')
  return (
    <a className="donate-card" href={DONATE_URL} target="_blank" rel="noopener noreferrer" aria-label={uiText('Поддержать проект — откроется страница DonatePay')}>
      <span className="donate-emblem"><BrandEmblem /></span>
      <span className="donate-copy">
        <span className="donate-brand">RAID OS</span>
        <span className="donate-title"><span>{first}</span> <span className="donate-accent">{rest.join(' ')}</span></span>
        <span className="donate-text">{uiText('Помогите развивать компаньон для Escape from Tarkov')}</span>
        <span className="donate-thanks"><Heart size={15} fill="currentColor" aria-hidden="true" />{uiText('Спасибо!')}</span>
      </span>
    </a>
  )
}
