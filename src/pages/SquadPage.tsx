import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Compass, LogIn, UserRound, Users } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { useServerAccount } from '../sync/serverSync'
import { useFriends } from '../squad/useFriends'
import { SquadPanel } from '../squad/SquadPanel'
import { FriendsPanel } from '../squad/FriendsPanel'
import { RaidPlanner } from '../squad/RaidPlanner'
import { modeLabel } from '../squad/squadLabels'
import '../squad/squad.css'

type Tab = 'squad' | 'friends' | 'plan'
const TABS: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: 'squad', label: 'Отряд', icon: Users },
  { id: 'friends', label: 'Друзья', icon: UserRound },
  { id: 'plan', label: 'План рейда', icon: Compass },
]

/**
 * «Отряд» (sidebar «Рейд»): the squad, friends and the pre-raid planner for the current mode. Links /squad/<code>
 * (join a squad) and /friend/<code> (add a friend) open here with the code filled in.
 */
export function SquadPage({ friendLink = false }: { friendLink?: boolean }) {
  const { raidMode } = useAppState()
  const { data } = useTarkovData()
  const { status, available } = useServerAccount()
  const { code } = useParams()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') as Tab | null
  const tab: Tab = friendLink ? 'friends' : requested && TABS.some((entry) => entry.id === requested) ? requested : 'squad'
  const setTab = (next: Tab) => setParams((current) => { const copy = new URLSearchParams(current); copy.set('tab', next); return copy }, { replace: true })
  const signedIn = Boolean(status?.signedIn)

  // One shared copy with the «Отряд» badge: a request answered anywhere shows here at once (squad/useFriends.ts).
  const { overview: friends, error: friendsError, loading: friendsLoading, reload: reloadFriends } = useFriends()
  useEffect(() => { if (signedIn) void reloadFriends() }, [signedIn, reloadFriends])

  return (
    <div className="page squad-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Рейд')} · {modeLabel(raidMode)}</div>
          <h1 className="page-title">{uiText('Отряд')}</h1>
          <p className="page-subtitle">{uiText('Общие задания отряда и друзей на карте, кому что нужно и с какой карты начать. PvP, PvE и Сезон — раздельно.')}</p>
        </div>
      </header>

      {!signedIn ? (
        <div className="panel empty-state squad-signin">
          <div>
            <LogIn size={28} />
            <h2>{uiText('Войдите в аккаунт сервера')}</h2>
            <p>{uiText(available ? 'Отряд и друзья работают через аккаунт Raid OS: задания участников приходят с сервера.' : 'Отряд доступен в приложении для ПК, в приложении для телефона и в личном кабинете на сайте.')}</p>
            {available && <Link className="button primary" to="/profile">{uiText('Войти')}</Link>}
          </div>
        </div>
      ) : (
        <>
          <div className="segmented-filter squad-tabs" role="tablist" aria-label={uiText('Разделы отряда')}>
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                <Icon size={14} />{uiText(label)}{id === 'friends' && friends?.incoming.length ? <span className="squad-count">{friends.incoming.length}</span> : null}
              </button>
            ))}
          </div>
          {tab === 'squad' && <SquadPanel mode={raidMode} data={data} friends={friends?.friends ?? []} initialCode={friendLink ? undefined : code} />}
          {tab === 'friends' && <FriendsPanel mode={raidMode} data={data} friends={friends} error={friendsError} loading={friendsLoading || (!friends && !friendsError)} reload={reloadFriends} initialCode={friendLink ? code : undefined} />}
          {tab === 'plan' && <RaidPlanner mode={raidMode} data={data} friends={friends?.friends ?? []} initialMapId={params.get('map') ?? undefined} />}
        </>
      )}
    </div>
  )
}
