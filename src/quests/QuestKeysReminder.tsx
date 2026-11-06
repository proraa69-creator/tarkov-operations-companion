import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, X } from 'lucide-react'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { useTarkovData } from '../data/DataProvider'
import type { RaidMode } from '../domain/types'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { useLocale } from '../i18n/LocaleProvider'
import { useDeferredQuests } from '../progression/deferredQuests'
import { modeResetName } from '../state/modeReset'
import { useAppState } from '../state/AppState'
import { useMinuteClock } from '../trading/tradingClock'
import { QUEST_KEY_REMINDER_AT, questKeyReminderDue, questKeysToldAt, rememberQuestKeysTold, staleFavoriteKeys, useQuestKeyFavorites, useQuestKeyReminder } from './questKeyFavorites'
import { questAvailabilityOf } from './questReadModel'
import { questKeyRows } from './questKeys'
import './questKeys.css'

function messageOf(count: number, mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { title: `Quest keys · ${name}`, text: `No longer needed among favorites: ${count}. Take them off.` }
    : { title: `Ключи для квестов · ${name}`, text: `В избранном больше не нужны: ${count}. Снимите их.` }
}

function Watcher({ profileId, mode, favorites }: { profileId: string; mode: RaidMode; favorites: ReadonlySet<string> }) {
  const { data, source } = useTarkovData()
  const state = useAppState()
  const { locale } = useLocale()
  const raid = useRaidState()
  const clock = useMinuteClock()
  const navigate = useNavigate()
  const progress = state.activeProfile.modes[mode]
  const loyalty = useTraderLoyalty()
  const deferred = useDeferredQuests(profileId, mode, progress.playerLevel, loyalty)
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const availability = useMemo(() => questAvailabilityOf(data.quests, progress), [data.quests, progress])
  const rows = useMemo(() => questKeyRows(data.quests, items, progress, availability, deferred), [data.quests, items, progress, availability, deferred])
  const [open, setOpen] = useState(false)
  // The catalog of another mode, or the built-in one before the first answer, says nothing about this mode's keys.
  const known = source !== 'demo' && data.metadata?.mode === mode
  const count = known ? staleFavoriteKeys(rows, favorites) : 0
  const inRaid = raidRunning(raid, clock)
  const { title, text } = messageOf(count, mode, locale)

  useEffect(() => {
    if (inRaid || !questKeyReminderDue(count, questKeysToldAt(profileId, mode), clock)) return
    rememberQuestKeysTold(profileId, mode, clock)
    void window.tarkovDesktop?.notify?.(title, text).catch(() => false)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the message comes once, when the store says it is due
    setOpen(true)
  }, [clock, count, inRaid, mode, profileId, text, title])

  if (!open || inRaid || count < QUEST_KEY_REMINDER_AT) return null
  return (
    <div className="restock-toasts" role="status" aria-live="polite">
      <div className="restock-toast quest-keys-toast">
        <KeyRound size={16} aria-hidden="true" />
        <button type="button" className="quest-keys-toast-body" onClick={() => { setOpen(false); navigate('/quest-keys?tab=favorites') }}><strong>{title}</strong><span>{text}</span></button>
        <button type="button" className="icon-button" aria-label={locale === 'en' ? 'Close' : 'Закрыть'} onClick={() => setOpen(false)}><X size={14} aria-hidden="true" /></button>
      </div>
    </div>
  )
}

/**
 * The message of «Ключи для квестов» (questKeyFavorites.ts): a system notification in the desktop app, a message inside the app
 * everywhere; nothing during a raid. Only this profile and mode. Off, or with too few stars to reach the threshold, it reads nothing.
 */
export function QuestKeysReminder() {
  const state = useAppState()
  const on = useQuestKeyReminder()
  const profileId = state.activeProfile.id
  const mode = state.raidMode
  const favorites = useQuestKeyFavorites(profileId, mode)
  if (!on || favorites.size < QUEST_KEY_REMINDER_AT) return null
  return <Watcher key={`${profileId}:${mode}`} profileId={profileId} mode={mode} favorites={favorites} />
}
