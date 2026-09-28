import { Gift, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../api'
import { useAuth } from '../auth'
import { normalizeReferralCode, REFERRAL_CODE_PATTERN, saveReferralCode } from '../storage'
import { HomePage } from './HomePage'

/** `/r/<code>`: remembers a streamer's referral code for registration and shows the regular landing. */
export function ReferralLandingPage() {
  const params = useParams()
  const code = normalizeReferralCode(params.code ?? '')
  const valid = REFERRAL_CODE_PATTERN.test(code)
  const { account } = useAuth()
  const [unknown, setUnknown] = useState(false)

  useEffect(() => {
    if (!valid) return
    saveReferralCode(code)
    // Count the visit once per browser session; errors (API offline) are ignored — the code is still remembered.
    const seenKey = `toc.visit.${code}`
    let seen = false
    try { seen = window.sessionStorage.getItem(seenKey) === '1' } catch { /* ignore */ }
    if (seen) return
    api.referralVisit(code).then(
      () => { try { window.sessionStorage.setItem(seenKey, '1') } catch { /* ignore */ } },
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) { saveReferralCode(null); setUnknown(true) }
      },
    )
  }, [code, valid])

  if (!valid) return <Navigate to="/" replace />

  const banner = unknown ? (
    <div className="panel referral-banner">
      <Gift aria-hidden="true" />
      <div className="text">
        <strong>Код приглашения «{code}» не найден</strong>
        <span>Проверьте ссылку у автора. Зарегистрироваться можно и без кода.</span>
      </div>
    </div>
  ) : (
    <div className="panel referral-banner">
      <Gift aria-hidden="true" />
      <div className="text">
        <strong>Вас пригласили · код <span className="mono" style={{ color: 'var(--brass-strong)', fontSize: 'inherit' }}>{code}</span></strong>
        <span>{account ? 'Код можно указать в личном кабинете, если он ещё не указан.' : 'Зарегистрируйтесь по приглашению и получите 3 дня бесплатного доступа.'}</span>
      </div>
      <Link to={account ? '/cabinet' : '/register'} className="button primary">
        <UserPlus aria-hidden="true" />{account ? 'Открыть кабинет' : 'Зарегистрироваться'}
      </Link>
    </div>
  )

  return <HomePage banner={banner} />
}
