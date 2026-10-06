import { Gift, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import { useAuth } from '../auth'
import { normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'
import { HomePage } from './HomePage'

/** The kind remembered from this tab's earlier visit (the visit is counted once per session, so it is not asked again). */
function loadVisitKind(code: string): 'streamer' | 'friend' | null {
  try {
    const value = window.sessionStorage.getItem(`toc.visit-kind.${code}`)
    return value === 'friend' || value === 'streamer' ? value : null
  } catch { return null }
}

/** `/r/<code>`: remembers a streamer's or a friend's referral code for registration and shows the regular landing. */
export function ReferralLandingPage() {
  const params = useParams()
  const code = normalizeReferralCode(params.code ?? '')
  // Optional campaign label of an audience link: /r/CODE?c=youtube (the server ignores unusable labels).
  const [search] = useSearchParams()
  const campaign = (search.get('c') ?? '').trim().toLowerCase().slice(0, 32)
  const valid = REFERRAL_CODE_PATTERN.test(code)
  const { account } = useAuth()
  const [unknown, setUnknown] = useState(false)
  // Whose code it is (the visit answer): a friend's code gives −20 % on the first month, a streamer's — 3 days free.
  const [kind, setKind] = useState<'streamer' | 'friend' | null>(() => loadVisitKind(code))

  useEffect(() => {
    if (!valid) return
    saveReferralCode(code)
    // Count the visit once per browser session; errors (API offline) are ignored — the code is still remembered.
    const seenKey = `toc.visit.${code}`
    let seen = false
    try { seen = window.sessionStorage.getItem(seenKey) === '1' } catch { /* ignore */ }
    if (seen) return
    api.referralVisit(code, /^[a-z0-9_-]{1,32}$/.test(campaign) ? campaign : undefined).then(
      (result) => {
        try { window.sessionStorage.setItem(seenKey, '1') } catch { /* ignore */ }
        if (result?.kind === 'friend' || result?.kind === 'streamer') {
          setKind(result.kind)
          try { window.sessionStorage.setItem(`toc.visit-kind.${code}`, result.kind) } catch { /* ignore */ }
        }
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) { saveReferralCode(null); setUnknown(true) }
      },
    )
  }, [code, valid, campaign])

  if (!valid) return <Navigate to="/" replace />

  const banner = unknown ? (
    <div className="panel referral-banner">
      <Gift aria-hidden="true" />
      <div className="text">
        <strong>Код приглашения «{code}» не найден</strong>
        <span>Проверьте ссылку у автора. Зарегистрироваться можно и без кода.</span>
      </div>
    </div>
  ) : kind === 'friend' ? (
    <div className="panel referral-banner">
      <Users aria-hidden="true" />
      <div className="text">
        <strong>Друг пригласил вас в Raid OS · код <span className="mono" style={{ color: 'var(--brass-strong)', fontSize: 'inherit' }}>{code}</span></strong>
        <span>{account ? 'Код друга можно указать в личном кабинете до первой оплаты — скидка 20 % на первый месяц.' : 'Зарегистрируйтесь — скидка 20 % на первый месяц.'}</span>
      </div>
      <Link to={account ? '/cabinet' : '/register'} className="button primary">
        <UserPlus aria-hidden="true" />{account ? 'Открыть кабинет' : 'Зарегистрироваться'}
      </Link>
    </div>
  ) : (
    <div className="panel referral-banner">
      <Gift aria-hidden="true" />
      <div className="text">
        <strong>Вас пригласили · код <span className="mono" style={{ color: 'var(--brass-strong)', fontSize: 'inherit' }}>{code}</span></strong>
        <span>{account ? 'Код можно указать в личном кабинете, если он ещё не указан.' : kind === 'streamer' ? 'Зарегистрируйтесь по приглашению и получите 3 дня бесплатного доступа.' : 'Зарегистрируйтесь по приглашению — бонус по коду применится сам.'}</span>
      </div>
      <Link to={account ? '/cabinet' : '/register'} className="button primary">
        <UserPlus aria-hidden="true" />{account ? 'Открыть кабинет' : 'Зарегистрироваться'}
      </Link>
    </div>
  )

  return <HomePage banner={banner} />
}
