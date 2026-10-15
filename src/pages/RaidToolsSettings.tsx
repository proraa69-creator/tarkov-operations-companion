import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, MapPinOff, MessageCircle, Power, ShieldAlert, X } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { isOwnerApp } from '../app/buildEdition'
import { SUPPORT_TELEGRAM_URL } from '../app/support'
import { checkAnnouncementNow } from '../announcement/announcement'
import { markMinimapNoticeSeen, minimapNoticeDue, minimapOverlayAllowed, parseFeatures, setRemoteFeatures, useRemoteFeatures } from '../announcement/features'
import type { ExperimentalSettings, ExperimentalStatus, ScreenshotKeyInfo } from '../overlay/types'
import { hotkeyLabel, isKnownHotkey, mouseHotkey } from '../overlay/hotkeys'
import { playerMarkerSvg } from '../overlay/playerMarker'
import { PositionSetupCard } from '../overlay/PositionSetupCard'
import './experimentalPage.css'

const OVERLAY_NOTE = 'Мини-карта и карточка предмета показываются поверх игры. Для этого в настройках графики поставьте режим экрана «Безрамочный».'

const ADMIN_NOTE = 'Лаунчер BSG запускает игру от имени администратора. Пока Raid OS работает без этих прав, Windows скрывает от него клавиши, нажатые в игре: мини-карта и карточка предмета по клавише не срабатывают. Скриншот, который вы делаете сами, мини-карта покажет и так.'

/**
 * The app presses no keys (owner, 14.10.2026: «человек сам … нажимает клавишу. не программа»): the game's «Скриншот» goes on
 * the minimap's key («сделай что бы человек билдил кнопку в игре одну и туже куда он билдит миникарту в приложении»).
 */
const SCREENSHOT_KEY_USE = 'Raid OS сам ничего не нажимает в игре: позицию даёт скриншот, который игра делает по этой клавише. Поставьте её в игре (Настройки → Управление → «Скриншот») на клавишу мини-карты — одно нажатие откроет мини-карту и обновит точку, а в папке останется только последний такой скриншот.'

/** The same while the owner keeps the window over the game off: any screenshot of the game moves the dot in the app. */
const SCREENSHOT_KEY_USE_TRACKING = 'Raid OS сам ничего не нажимает в игре: позицию даёт скриншот, который игра делает по этой клавише. Сделайте скриншот в рейде — точка на карте в приложении обновится.'

/**
 * The owner keeps the window over the game off, the tracking on (owner, 14.10.2026: «отключить именно мини карту по
 * кнопке. то есть ее выключаешь и местоположение появляется только в приложении»): one quiet line, no dialog.
 */
export const OVERLAY_OFF_LINE = 'Окно мини-карты поверх игры временно выключено — позиция показывается на карте в приложении.'

/** «Отключить мини-карту» (owner, 14.10.2026: «отключить карту полностью и эта функция не будет работать»). */
const MINIMAP_ON_NOTE = 'Клавиша карты открывает мини-карту поверх игры. Позицию даёт скриншот, который делает сама игра по той же клавише, — она видна здесь и в телефоне.'
/** The player's own switch while the window over the game is off: it turns the tracking on or off. */
const TRACKING_ON_NOTE = 'Позицию даёт скриншот, который делает сама игра по клавише «Скриншот», — она видна на карте в приложении и в телефоне.'
const MINIMAP_OFF_NOTE = 'Клавиша карты ничего не делает: приложение не открывает мини-карту и не следит за папкой скриншотов, поэтому вашей позиции нет ни на картах, ни в телефоне. Информация о предмете работает как раньше.'

/**
 * The one-time notice while the owner keeps the minimap off for everybody (owner, 14.10.2026: «когда люди зайдут в блок
 * мини карта, у них появится разовое уведомление во всплывающем окне… и кнопка на телеграм»).
 */
export const MINIMAP_OFF_NOTICE = 'Функция мини-карты временно выключена — для спокойствия пользователей. Ожидаем официального ответа от BSG! Спасибо за понимание. Если возникли вопросы, задайте их в нашем Telegram.'

const PLAYER_MARKERS: Array<{ id: ExperimentalSettings['playerMarker']; label: string }> = [
  { id: 'arrow', label: 'Стрелка' },
  { id: 'chevron', label: 'Шеврон' },
  { id: 'dot', label: 'Точка' },
]

/** The game's screenshot key and where it was read, in one short line. */
function screenshotKeyText(key: ExperimentalStatus['screenshotKey'] | undefined, overlay: boolean) {
  if (!key) return uiText('Определяю клавишу скриншота…')
  if (key.unbound) return uiText(overlay ? 'В игре клавиша скриншота не назначена. Назначьте её в игре (Настройки → Управление → «Скриншот») на клавишу мини-карты.' : 'В игре клавиша скриншота не назначена. Назначьте её в игре (Настройки → Управление → «Скриншот»).')
  const source: Record<ScreenshotKeyInfo['source'], string> = {
    'game-settings': 'По настройкам игры:',
    'game-log': 'По журналу игры:',
    default: 'В настройках игры не найдена, по умолчанию:',
  }
  return `${uiText(source[key.source])} ${key.label}`
}

/**
 * «Мини Карта». While the owner keeps the minimap off for everybody (src/announcement/features.ts; owner, 14.10.2026:
 * «по кнопке выключить в реальном времени должны исчезать зачеркнутые блоки»), everything about the minimap over the game
 * and the position tracking is not drawn at all; the item card, the Collector scan and the administrator rights stay.
 * With the tracking on and the window over the game off (the owner's second switch), only what belongs to the window
 * goes: the borderless note, its opacity, key and size, «Показать / скрыть»; the position's own blocks stay.
 */
export function ExperimentalPage() {
  const api = window.tarkovDesktop?.experimental
  const features = useRemoteFeatures()
  const minimap = features.minimap
  const overlay = minimapOverlayAllowed(features)
  // Seen (stored in this installation): drawn again without the notice.
  const [, setNoticeSeen] = useState(0)
  const notice = Boolean(api) && minimapNoticeDue(features)
  // Entering the page asks the server again (a switch shows here before the next regular check).
  useEffect(() => { void checkAnnouncementNow() }, [])
  const closeNotice = useCallback(() => {
    markMinimapNoticeSeen(features)
    setNoticeSeen((count) => count + 1)
  }, [features])
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
    const refresh = () => void api.getStatus().then(setStatus).catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Не удалось проверить функции мини-карты.'))
    // Every 2 s while the window is in use (a changed setting shows at once), at once when the player comes back to it,
    // and never while the app sits behind the game: each answer may cost the main process a registry read and a search
    // of the game's folders (src/app/activePolling.ts).
    return startActivePolling(refresh, { activeEveryMs: 2000 })
  }, [api])

  const update = (patch: Partial<ExperimentalSettings>) => {
    if (!api || !settings) return
    setSettings({ ...settings, ...patch })
    void perform(() => api.updateSettings(patch), setSettings)
  }

  const restartAsAdmin = () => {
    setAdminRefused(false)
    if (api) void perform(() => api.relaunchAsAdmin(), (started) => setAdminRefused(!started))
  }

  const manualFolder = settings?.screenshotsDir ?? ''
  const folderNote = !manualFolder
    ? ' (найдена автоматически)'
    : status?.screenshotsFolder === manualFolder ? ' (выбрана вручную)' : ' (в выбранной вручную папке нет скриншотов игры — использую папку игры)'

  return (
    <div className="page experimental-page">
      <header className="page-header">
        <div>
          <h1 className="page-title exp-title">{uiText('Функции мини-карты и информация о предмете во время рейда')}</h1>
        </div>
      </header>

      {!api ? (
        <section className="panel"><div className="panel-body">{uiText('Эти функции работают только в приложении для Windows.')}</div></section>
      ) : (
        <>
          {actionError && <p className="notice error" role="alert">{actionError}</p>}
          {status?.nativeError && <p className="notice error" role="alert">{uiText('Не удалось загрузить модуль клавиатуры и захвата экрана:')} {status.nativeError}</p>}
          {isOwnerApp() && <OwnerMinimapSwitch on={minimap} overlay={features.minimapOverlay} />}
          {minimap && !overlay && <p className="exp-overlay-off muted" role="note">{uiText(OVERLAY_OFF_LINE)}</p>}
          {minimap && settings && <MinimapPower off={settings.minimapOff} overlay={overlay} onChange={(minimapOff) => update({ minimapOff })} />}
          {minimap && status && settings && !settings.minimapOff && <PositionSetupCard status={status} overlay={overlay} onFixed={() => void api.getStatus().then(setStatus).catch(() => {})} />}
          {overlay && (
            <section className={`panel exp-warning${status?.displayMode === 'exclusive' ? ' is-alert' : ''}`}>
              <div className="panel-body">
                <AlertTriangle size={18} />
                <p>{uiText(OVERLAY_NOTE)}{status?.displayMode === 'exclusive' ? <strong>{uiText(' Сейчас игра в эксклюзивном полноэкранном режиме — окна поверх неё не видны.')}</strong> : null}</p>
              </div>
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
                  <small className="muted">{uiText('Чтобы приложение всегда запускалось с этими правами, включите «Запускать от имени администратора» в функциях ниже.')}</small>
                </div>
              </div>
            </section>
          )}

          <div className={`settings-grid${minimap ? '' : ' is-single'}`}>
            <section className="panel">
              <div className="panel-header"><div className="panel-title">{uiText('Функции')}</div></div>
              <div className="panel-body">
                <HotkeyRow
                  label="Клавиша информации о предмете"
                  hint="Показывает цену на барахолке и у выгодного торговца, а также нужен ли предмет для Каппы."
                  value={settings?.itemKey ?? 'Semicolon'}
                  taken={[settings?.minimapKey, settings?.collectorKey]}
                  onChange={(itemKey) => update({ itemKey })}
                />
                {overlay && (
                  <div className="setting-row">
                    <span>
                      <strong>{uiText('Прозрачность мини-карты')}</strong>
                      <small>{`${Math.round((settings?.minimapOpacity ?? 0.9) * 100)}%`}</small>
                    </span>
                    <input type="range" min={30} max={100} step={5} value={Math.round((settings?.minimapOpacity ?? 0.9) * 100)} onChange={(event) => update({ minimapOpacity: Number(event.target.value) / 100 })} />
                  </div>
                )}
                {/* The marker is drawn on the app's maps too: it stays while the window over the game is off. */}
                {minimap && <div className="setting-row">
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
                </div>}
                {overlay && <>
                <HotkeyRow
                  label="Клавиша мини-карты"
                  hint="Показывает и скрывает мини-карту в рейде."
                  value={settings?.minimapKey ?? 'KeyM'}
                  taken={[settings?.itemKey, settings?.collectorKey]}
                  onChange={(minimapKey) => update({ minimapKey })}
                />
                <div className="setting-row">
                  <span><strong>{uiText('Размер мини-карты')}</strong><small>{settings?.minimapWidth ?? 420} px</small></span>
                  <input type="range" min={280} max={720} step={20} value={settings?.minimapWidth ?? 420} aria-label={uiText('Размер мини-карты')} onChange={(event) => update({ minimapWidth: Number(event.target.value) })} />
                </div>
                </>}
                <HotkeyRow
                  label="Клавиша сканирования предметов для коллекционера"
                  hint="Поместите все предметы для квеста «Коллекционер» в один контейнер."
                  value={settings?.collectorKey ?? ''}
                  taken={[settings?.itemKey, settings?.minimapKey]}
                  onChange={(collectorKey) => update({ collectorKey })}
                />
                {minimap && (
                  <div className="setting-row exp-screenshot-key">
                    <span>
                      <strong>{uiText('Клавиша скриншота в игре')}</strong>
                      <small className="exp-key-found">{screenshotKeyText(status?.screenshotKey, overlay)}</small>
                      <small>{uiText(overlay ? SCREENSHOT_KEY_USE : SCREENSHOT_KEY_USE_TRACKING)}</small>
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

            {minimap && <section className="panel exp-side">
              <div className="panel-header"><div className="panel-title">{uiText('Папка со скриншотами')}</div></div>
              <div className="panel-body exp-status">
                <div className="exp-folder">
                  <span className="muted">{status?.screenshotsFolder ?? '…'}{uiText(folderNote)}</span>
                  <span className="exp-folder-actions">
                    <button className="button ghost small" onClick={() => void perform(() => api.pickScreenshotsFolder(), setSettings)}>{uiText('Выбрать папку со скриншотами')}</button>
                    <button className="button ghost small" onClick={() => update({ screenshotsDir: '' })}>{uiText('Определить автоматически')}</button>
                  </span>
                </div>
                {overlay && (
                  <div className="exp-actions exp-minimap-action">
                    <button className="button ghost" disabled={Boolean(settings?.minimapOff)} onClick={() => void perform(() => api.toggleMinimap())}>{uiText('Показать / скрыть мини-карту')}</button>
                  </div>
                )}
              </div>
            </section>}
          </div>
        </>
      )}
      {notice && <MinimapOffNotice onClose={closeNotice} />}
    </div>
  )
}

/** The one-time notice (see MINIMAP_OFF_NOTICE), in the app's dialog style; Telegram opens in the system browser. */
function MinimapOffNotice({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay minimap-off-overlay" role="dialog" aria-modal="true" aria-label={uiText('Мини-карта')} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog minimap-off-dialog">
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <div className="registration-icon"><MapPinOff size={26} aria-hidden="true" /></div>
        <p className="minimap-off-text">{uiText(MINIMAP_OFF_NOTICE)}</p>
        <div className="minimap-off-actions">
          <a className="button ghost" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} aria-hidden="true" />Telegram</a>
          <button type="button" className="button primary" onClick={onClose}>{uiText('Понятно')}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

const FEATURES_PATH = '/v1/accounts/me/admin/features'

/**
 * The owner app only (owner, 14.10.2026: «у меня кнопка которая моментально убирает эти меню функций из приложения»; «сделай
 * две кнопки: выключить полностью как я сказал, а при включении функции добавь отдельную кнопку, отключить именно мини
 * карту по кнопке»): the minimap and the tracking on or off for every app, and while they are on, the window over the
 * game alone (server/src/routes/announcement.ts). This page follows at once; the players' apps at their next check.
 */
function OwnerMinimapSwitch({ on, overlay }: { on: boolean; overlay: boolean }) {
  const request = window.tarkovDesktop?.serviceRequest
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async (body: { minimap?: boolean; minimapOverlay?: boolean }) => {
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
    <section className={`panel exp-power exp-owner-switch${on ? '' : ' is-off'}`} aria-label={uiText('Функции мини-карты')}>
      <div className="panel-body">
        <Power size={18} aria-hidden="true" />
        <div className="exp-power-body">
          <strong>{uiText('Функции мини-карты')} <small className="exp-owner-hint">· {uiText('Эту карточку видит только владелец.')}</small></strong>
          <div className="exp-owner-row">
            <span>{uiText('Мини-карта и отслеживание:')} <b className={`exp-owner-state${on ? ' is-on' : ''}`}>{uiText(on ? 'включены у всех' : 'выключены у всех')}</b></span>
            <button type="button" className={`button small ${on ? 'ghost' : 'primary'}`} disabled={busy || !request} onClick={() => void send({ minimap: !on })}>
              {uiText(on ? 'Выключить для всех' : 'Включить для всех')}
            </button>
          </div>
          {on && (
            <div className="exp-owner-row">
              <span>{uiText('Окно мини-карты поверх игры:')} <b className={`exp-owner-state${overlay ? ' is-on' : ''}`}>{uiText(overlay ? 'включено у всех' : 'выключено у всех')}</b></span>
              <button type="button" className={`button small ${overlay ? 'ghost' : 'primary'}`} disabled={busy || !request} onClick={() => void send({ minimapOverlay: !overlay })}>
                {uiText(overlay ? 'Выключить окно для всех' : 'Включить окно для всех')}
              </button>
            </div>
          )}
          {error && <small className="is-error" role="alert">{error}</small>}
        </div>
      </div>
    </section>
  )
}

/** The minimap on or off as a whole, at the top of the page: one button, and what it means in words. */
function MinimapPower({ off, overlay, onChange }: { off: boolean; overlay: boolean; onChange: (off: boolean) => void }) {
  return (
    <section className={`panel exp-power${off ? ' is-off' : ''}`} aria-label={uiText('Мини-карта')}>
      <div className="panel-body">
        <Power size={18} aria-hidden="true" />
        <div className="exp-power-body">
          <strong>{uiText(off ? 'Мини-карта отключена' : 'Мини-карта включена')}</strong>
          <p>{uiText(off ? MINIMAP_OFF_NOTE : overlay ? MINIMAP_ON_NOTE : TRACKING_ON_NOTE)}</p>
        </div>
        <button type="button" className={`button ${off ? 'primary' : 'ghost'}`} aria-pressed={off} onClick={() => onChange(!off)}>
          {uiText(off ? 'Включить мини-карту' : 'Отключить мини-карту')}
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
