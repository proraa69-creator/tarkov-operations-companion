import { Heart } from 'lucide-react'
import { tr } from '../i18n'
import './donateCard.css'

/** The donation page («Поддержать проект», owner 13.10.2026; the same link as the app's src/app/support.ts). */
export const DONATE_URL = 'https://donatepay.ru/don/1537561'

/**
 * «Поддержать проект» after the owner's design: the Raid OS tile, «RAID OS», «ПОДДЕРЖАТЬ ПРОЕКТ», «Помогите развивать
 * компаньон для Escape from Tarkov», «Спасибо!». On «Скачать приложение» and in the personal cabinet.
 */
export function DonateCard() {
  // One phrase in both languages; its first word plain, the rest in olive.
  const [first, ...rest] = tr('Поддержать проект').split(' ')
  return (
    <a className="donate-card" href={DONATE_URL} target="_blank" rel="noopener noreferrer" aria-label={tr('Поддержать проект — откроется страница DonatePay')}>
      <img className="donate-emblem" src="/brand/icon.svg" alt="" aria-hidden="true" width={92} height={92} />
      <span className="donate-copy">
        <span className="donate-brand">RAID OS</span>
        <span className="donate-title"><span>{first}</span> <span className="donate-accent">{rest.join(' ')}</span></span>
        <span className="donate-text">{tr('Помогите развивать компаньон для Escape from Tarkov')}</span>
        <span className="donate-thanks"><Heart size={15} fill="currentColor" aria-hidden="true" />{tr('Спасибо!')}</span>
      </span>
    </a>
  )
}
