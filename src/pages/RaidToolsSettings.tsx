import { uiText } from '../i18n/renderText'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, MapPinned, MessageCircle, Power, ShieldAlert } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { isOwnerApp } from '../app/buildEdition'
import { SUPPORT_TELEGRAM_URL } from '../app/support'
import { checkAnnouncementNow } from '../announcement/announcement'
import { parseFeatures, setRemoteFeatures, useRemoteFeatures } from '../announcement/features'
import type { ExperimentalSettings, ExperimentalStatus, ScreenshotKeyInfo } from '../overlay/types'
import { hotkeyLabel, isKnownHotkey, mouseHotkey } from '../overlay/hotkeys'
import { playerMarkerSvg } from '../overlay/playerMarker'
import { PositionSetupCard } from '../overlay/PositionSetupCard'
import './raidToolsSettings.css'
import '../styles/playerMarker.css'

/**
 * Where the in-raid functions show now (owner, 15.10.2026: «убирай функции оверлей, карта поверх игры и информация о
 * предмете поверх игры. все это будет только в приложении на карте… Перенесем эти функции в телефоне, что бы не считалось
 * оверлеем»): nothing is drawn over the game.
 */
export const RAID_TOOLS_INTRO = 'Поверх игры Raid OS ничего не показывает. Ваша позиция и информация о предмете появляются на «Картах» в приложении и сразу же в телефоне, если вы вошли в тот же аккаунт.'

const ADMIN_NOTE = 'Лаунчер BSG запускает игру от имени администратора. Пока Raid OS работает без этих прав, Windows скрывает от него клавиши, нажатые в игре: клавиша информации о предмете не срабатывает. Позиция по скриншотам игры обновляется и так.'

/** The app presses no keys (owner, 14.10.2026: «человек сам … нажимает клавишу. не программа»). */
const SCREENSHOT_KEY_USE = 'Raid OS сам ничего не нажимает в игре: позицию даёт скриншот, который игра делает по этой клавише. Сделайте скриншот в рейде — точка на «Картах» в приложении и в телефоне обновится.'

/** «Отключить местоположение» (was «Отключить мини-карту», owner, 14.10.2026: «отключить карту полностью»). */
const TRACKING_ON_NOTE = 'Позицию даёт скриншот, который делает сама игра по клавише «Скриншот», — она видна на «Картах» в приложении и в телефоне.'
const TRACKING_OFF_NOTE = 'Приложение не следит за папкой скриншотов, поэтому вашей позиции нет ни на картах, ни в телефоне. Информация о предмете работает как раньше.'

/** The owner keeps the position off for everybody (owner, 14.10.2026): one quiet line instead of the old dialog. */
export const TRACKING_OFF_FOR_ALL = 'Местоположение по скриншотам временно выключено для всех — ожидаем официального ответа от BSG. Если возникли вопросы, задайте их в нашем Telegram.'

const EXCLUSIVE_NOTE = 'Игра сейчас в эксклюзивном полноэкранном режиме: так она скрыта от чтения экрана, и предмет не распознаётся. Поставьте в настройках графики режим «Безрамочный».'

const PLAYER_MARKERS: Array<{ id: ExperimentalSettings['playerMarker']; label: string }> = [
  { id: 'arrow', label: 'Стрелка' },
  { id: 'chevron', label: 'Шеврон' },
  { id: 'dot', label: 'Точка' },
]

/** The game's screenshot key and where it was read, in one short line. */
function screenshotKeyText(key: ExperimentalStatus['screenshotKey'] | undefined) {
  if (!key) return uiText('Определяю клавишу скриншота…')
  if (key.unbound) return uiText('В игре клавиша скриншота не назначена. Назначьте её в игре (Настройки → Управление → «Скриншот»).')
  const source: Record<ScreenshotKeyInfo['source'], string> = {
    'game-settings': 'По настройкам игры:',
    'game-log': 'По журналу игры:',
    default: 'В настройках игры не найдена, по умолчанию:',
  }
  return `${uiText(source[key.source])} ${key.label}`
}

/**
 * «Настройки» → «Карта и предметы в рейде» (the PC app): the item key and the Collector scan key, the position from the
 * game's screenshots (on or off, the screenshots folder, the marker), administrator rights. It replaces the «Мини Карта»
 * page of the in-game overlays (owner, 15.10.2026). While the owner keeps the position off for everybody
 * (src/announcement/features.ts) its blocks are not drawn at all; the item key, the Collector scan and the
 * administrator rights stay.
 */
export function RaidToolsSettings() {
  const api = window.tarkovDesktop?.experimental
  const features = useRemoteFeatures()
  const tracking = features.minimap
  // Opening the settings asks the server again (a switch shows here before the next regular check).
  useEffect(() => { if (api) void checkAnnouncementNow() }, [api])
  const [settings, setSettings] = useState<ExperimentalSettings | null>(null)
  const [status, setStatus] = useState<ExperimentalStatus | null>(null)
  const [adminRefused, setAdminRefused] = useState(false)
  const [actionError, setActionError] = useState('')
  const perform = async <T,>(action: () => Promise<T>, done?: (value: T) => void) => {
    setActionError('')
    try { const value = await action(); done?.(value) }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Не удалось выполнить действие.') }
  }

  useEffect(() => {
    if (!api) return
    void api.getSettings().then(setSettings).catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Не удалось загрузить настройки.'))
    const refresh = () => void api.getStatus().then(setStatus).catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Не удалось проверить состояние функций.'))
    // Every 2 s while the window is in use (a changed setting shows at once), at once when the player comes back to it,
    // and never while the app sits behind the game: each answer may cost the main process a registry read and a search
    // of the game's folders (src/app/activePolling.ts).
    return startActivePolling(refresh, { activeEveryMs: 2000 })
  }, [api])

  if (!api) return null

  const update = (patch: Partial<ExperimentalSettings>) => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    void perform(() => api.updateSettings(patch), setSettings)
  }

  const restartAsAdmin = () => {
    setAdminRefused(false)
    void perform(() => api.relaunchAsAdmin(), (started) => setAdminRefused(!started))
  }

  const manualFolder = settings?.screenshotsDir ?? ''
  const folderNote = !manualFolder
    ? ' (найдена автоматически)'
    : status?.screenshotsFolder === manualFolder ? ' (выбрана вручную)' : ' (в выбранной вручную папке нет скриншотов игры — использую папку игры)'
  const positionOn = tracking && settings && !settings.minimapOff

  return (
    <section className="raid-tools" aria-label={uiText('Карта и предметы в рейде')}>
      <header className="raid-tools-head">
        <MapPinned size={18} aria-hidden="true" />
        <div>
          <h2>{uiText('Карта и предметы в рейде')}</h2>
          <p>{uiText(RAID_TOOLS_INTRO)}</p>
        </div>
      </header>
      {actionError && <p className="notice error" role="alert">{actionError}</p>}
      {status?.nativeError && <p className="notice error" role="alert">{uiText('Не удалось загрузить модуль клавиатуры и захвата экрана:')} {status.nativeError}</p>}
      {isOwnerApp() && <OwnerTrackingSwitch on={tracking} />}
      {!tracking && features.known && (
        <p className="exp-overlay-off muted" role="note">
          {uiText(TRACKING_OFF_FOR_ALL)}{' '}
          <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} aria-hidden="true" /> Telegram</a>
        </p>
      )}
      {tracking && settings && <TrackingPower off={settings.minimapOff} onChange={(minimapOff) => update({ minimapOff })} />}
      {positionOn && status && <PositionSetupCard status={status} onFixed={() => void api.getStatus().then(setStatus).catch(() => {})} />}
      {status?.displayMode === 'exclusive' && (
        <section className="panel exp-warning is-alert">
          <div className="panel-body"><AlertTriangle size={18} /><p>{uiText(EXCLUSIVE_NOTE)}</p></div>
        </section>
      )}

      {status?.elevated === false && (
        <section className="panel exp-warning is-alert exp-admin">
          <div className="panel-body">
            <ShieldAlert size={18} />
            <div className="exp-admin-body">
              <strong>{uiText('Приложение запущено без прав администратора')}</strong>
              <p>{uiText(ADMIN_NOTE)}</p>
              <div className="exp-actions">
                <button className="button primary" onClick={restartAsAdmin}>{uiText('Перезапустить от имени администратора')}</button>
              </div>
              {adminRefused && <small className="is-error">{uiText('Windows не дал права администратора — приложение работает дальше без них.')}</small>}
              <small className="muted">{uiText('Чтобы приложение всегда запускалось с этими правами, включите «Запускать от имени администратора» ниже.')}</small>
            </div>
          </div>
        </section>
      )}

      <div className={`settings-grid${tracking ? '' : ' is-single'}`}>
        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText('Клавиши')}</div></div>
          <div className="panel-body">
            <HotkeyRow
              label="Клавиша информации о предмете"
              hint="Наведите курсор на предмет в игре и нажмите клавишу: цена на барахолке и у выгодного торговца, для каких квестов он нужен и нужен ли для Каппы, появится на «Картах» под кнопкой «Вид» и в телефоне."
              value={settings?.itemKey ?? 'Semicolon'}
              taken={[settings?.collectorKey]}
              onChange={(itemKey) => update({ itemKey })}
            />
            <HotkeyRow
              label="Клавиша сканирования предметов для коллекционера"
              hint="Поместите все предметы для квеста «Коллекционер» в один контейнер."
              value={settings?.collectorKey ?? ''}
              taken={[settings?.itemKey]}
              onChange={(collectorKey) => update({ collectorKey })}
            />
            {tracking && (
              <div className="setting-row exp-screenshot-key">
                <span>
                  <strong>{uiText('Клавиша скриншота в игре')}</strong>
                  <small className="exp-key-found">{screenshotKeyText(status?.screenshotKey)}</small>
                  <small>{uiText(SCREENSHOT_KEY_USE)}</small>
                </span>
              </div>
            )}
            <Toggle
              icon={<ShieldAlert size={16} />}
              title="Запускать от имени администратора"
              hint="Игра работает с правами администратора, поэтому приложению нужны такие же, чтобы видеть клавиши в игре. Windows спросит разрешение при запуске."
              on={Boolean(settings?.runAsAdmin)}
              onChange={(runAsAdmin) => update({ runAsAdmin })}
            />
          </div>
        </section>

        {tracking && <section className="panel exp-side">
          <div className="panel-header"><div className="panel-title">{uiText('Местоположение на карте')}</div></div>
          <div className="panel-body exp-status">
            <div className="setting-row">
              <span>
                <strong>{uiText('Обозначение игрока')}</strong>
                <small>{uiText('Как показывать вашу позицию на картах')}</small>
              </span>
              <div className="marker-pick">
                {PLAYER_MARKERS.map((option) => (
                  <button key={option.id} type="button" className={(settings?.playerMarker ?? 'arrow') === option.id ? 'active' : ''} onClick={() => update({ playerMarker: option.id })} title={uiText(option.label)}>
                    <span dangerouslySetInnerHTML={{ __html: playerMarkerSvg(option.id, 0) }} />
                    <small>{uiText(option.label)}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="exp-folder">
              <strong>{uiText('Папка со скриншотами')}</strong>
              <span className="muted">{status?.screenshotsFolder ?? '…'}{uiText(folderNote)}</span>
              <span className="exp-folder-actions">
                <button className="button ghost small" onClick={() => void perform(() => api.pickScreenshotsFolder(), setSettings)}>{uiText('Выбрать папку со скриншотами')}</button>
                <button className="button ghost small" onClick={() => update({ screenshotsDir: '' })}>{uiText('Определить автоматически')}</button>
              </span>
            </div>
          </div>
        </section>}
      </div>
    </section>
  )
}

const FEATURES_PATH = '/v1/accounts/me/admin/features'

/**
 * The owner app only (owner, 14.10.2026: «у меня кнопка которая моментально убирает эти меню функций из приложения»):
 * the position from the screenshots on or off for every app (server/src/routes/announcement.ts `minimap`). This page
 * follows at once; the players' apps at their next check. The server's second switch, the minimap window over the game,
 * concerns only the apps from before 15.10.2026: this app has no such window, so it has no button here.
 */
function OwnerTrackingSwitch({ on }: { on: boolean }) {
  const request = window.tarkovDesktop?.serviceRequest
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async (body: { minimap: boolean }) => {
    if (!request || busy) return
    setBusy(true)
    setError('')
    try {
      const saved = parseFeatures(await request('PUT', FEATURES_PATH, body))
      if (!saved) throw new Error('no answer')
      setRemoteFeatures(saved)
    } catch {
      setError(uiText('Не удалось переключить. Проверьте вход в аккаунт владельца и попробуйте ещё раз.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={`panel exp-power exp-owner-switch${on ? '' : ' is-off'}`} aria-label={uiText('Местоположение у всех')}>
      <div className="panel-body">
        <Power size={18} aria-hidden="true" />
        <div className="exp-power-body">
          <strong>{uiText('Местоположение у всех')} <small className="exp-owner-hint">· {uiText('Эту карточку видит только владелец.')}</small></strong>
          <div className="exp-owner-row">
            <span>{uiText('Позиция по скриншотам:')} <b className={`exp-owner-state${on ? ' is-on' : ''}`}>{uiText(on ? 'включена у всех' : 'выключена у всех')}</b></span>
            <button type="button" className={`button small ${on ? 'ghost' : 'primary'}`} disabled={busy || !request} onClick={() => void send({ minimap: !on })}>
              {uiText(on ? 'Выключить для всех' : 'Включить для всех')}
            </button>
          </div>
          {error && <small className="is-error" role="alert">{error}</small>}
        </div>
      </div>
    </section>
  )
}

/** The player's own position switch, at the top: one button, and what it means in words. */
function TrackingPower({ off, onChange }: { off: boolean; onChange: (off: boolean) => void }) {
  return (
    <section className={`panel exp-power${off ? ' is-off' : ''}`} aria-label={uiText('Местоположение')}>
      <div className="panel-body">
        <Power size={18} aria-hidden="true" />
        <div className="exp-power-body">
          <strong>{uiText(off ? 'Местоположение отключено' : 'Местоположение включено')}</strong>
          <p>{uiText(off ? TRACKING_OFF_NOTE : TRACKING_ON_NOTE)}</p>
        </div>
        <button type="button" className={`button ${off ? 'primary' : 'ghost'}`} aria-pressed={off} onClick={() => onChange(!off)}>
          {uiText(off ? 'Включить местоположение' : 'Отключить местоположение')}
        </button>
      </div>
    </section>
  )
}

function Toggle({ icon, title, hint, on, disabled, onChange }: { icon: ReactNode; title: string; hint: string; on: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className={`setting-row exp-toggle${disabled ? ' is-disabled' : ''}`}>
      <span>
        <strong>{icon}{uiText(title)}</strong>
        <small>{uiText(hint)}</small>
      </span>
      <button className={`toggle ${on ? 'on' : ''}`} disabled={disabled} aria-pressed={on} aria-label={uiText(title)} onClick={() => onChange(!on)}>
        <span />
      </button>
    </div>
  )
}

function HotkeyRow({ label, hint, value, taken = [], onChange }: { label: string; hint: string; value: string; taken?: Array<string | undefined>; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!listening) return
    const pick = (code: string) => {
      if (taken.includes(code)) { setError('Эта клавиша уже занята другой функцией.'); return }
      setError('')
      setListening(false)
      onChange(code)
    }
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') { setListening(false); setError(''); return }
      if (!isKnownHotkey(event.code)) { setError('Эту клавишу назначить нельзя. Подойдут буквы, цифры, F1–F12, знаки и кнопки мыши 4, 5 и колесо.'); return }
      pick(event.code)
    }
    // Extra mouse buttons: the side buttons 4 / 5 and the wheel click (left and right stay for the page).
    const onMouse = (event: MouseEvent) => {
      const code = mouseHotkey(event.button)
      if (!code) return
      event.preventDefault()
      event.stopPropagation()
      pick(code)
    }
    const swallow = (event: MouseEvent) => { if (mouseHotkey(event.button)) { event.preventDefault(); event.stopPropagation() } }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
    window.addEventListener('mouseup', swallow, true)
    window.addEventListener('auxclick', swallow, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('mouseup', swallow, true)
      window.removeEventListener('auxclick', swallow, true)
    }
  }, [listening, taken, onChange])

  return (
    <div className="setting-row exp-hotkey">
      <span>
        <strong>{uiText(label)}</strong>
        <small className={error ? 'is-error' : ''}>{uiText(error || (listening ? 'Нажмите клавишу или кнопку мыши 4, 5, колесо · Esc — отмена' : hint))}</small>
      </span>
      <button type="button" className={`button ${listening ? 'primary' : 'ghost'} hotkey-button`} onClick={() => { setError(''); setListening((state) => !state) }}>
        <kbd>{listening ? '…' : value ? hotkeyLabel(value) : uiText('не назначена')}</kbd>
      </button>
    </div>
  )
}
