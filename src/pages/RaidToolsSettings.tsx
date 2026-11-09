import { uiText } from '../i18n/renderText'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, MapPinned, MessageCircle, ShieldAlert } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { SUPPORT_TELEGRAM_URL } from '../app/support'
import { checkAnnouncementNow } from '../announcement/announcement'
import { useRemoteFeatures } from '../announcement/features'
import { SettingHelp } from '../components/SettingHelp'
import type { SettingHelpId } from '../components/settingHelpTexts'
import type { ExperimentalSettings, ExperimentalStatus } from '../overlay/types'
import { comboMouseHotkey, HOTKEYS, hotkeyCode, hotkeyLabel, isComboHotkey, isKnownHotkey, mouseHotkey, type HotkeyModifier } from '../overlay/hotkeys'
import { playerMarkerSvg } from '../overlay/playerMarker'
import { PresetKeyRows } from '../screen/ScreenRaidPanel'
import './raidToolsSettings.css'
import '../styles/playerMarker.css'

/**
 * Where the in-raid functions show (owner, 15.10.2026: «все это будет только в приложении на карте… Перенесем эти функции
 * в телефоне»). No words about drawing over the game or pressing keys at all (owner, 15.10.2026).
 */
export const RAID_TOOLS_INTRO = 'Ваша позиция и информация о предмете появляются на «Картах» в приложении и сразу же в телефоне, если вы вошли в тот же аккаунт.'

const ADMIN_NOTE = 'Лаунчер BSG запускает игру от имени администратора. Пока Raid OS работает без этих прав, Windows скрывает от него клавиши, нажатые в игре: клавиша информации о предмете не срабатывает. Позиция по скриншотам игры обновляется и так.'

/** The owner keeps the position off for everybody (owner, 14.10.2026): one quiet line instead of the old dialog. */
export const TRACKING_OFF_FOR_ALL = 'Местоположение по скриншотам временно выключено для всех — ожидаем официального ответа от BSG. Если возникли вопросы, задайте их в нашем Telegram.'

const EXCLUSIVE_NOTE = 'Игра сейчас в эксклюзивном полноэкранном режиме: так она скрыта от чтения экрана, и предмет не распознаётся. Поставьте в настройках графики режим «Безрамочный».'

const PLAYER_MARKERS: Array<{ id: ExperimentalSettings['playerMarker']; label: string }> = [
  { id: 'arrow', label: 'Стрелка' },
  { id: 'chevron', label: 'Шеврон' },
  { id: 'dot', label: 'Точка' },
]

/** The PC app only: this section is drawn where the bridge to the main process exists. */
export const hasRaidTools = () => Boolean(window.tarkovDesktop?.experimental)

/**
 * «Настройки» → «Карта и предметы в рейде» (the PC app): the item key and the Collector scan key, the position from the
 * game's screenshots (on or off, the screenshots folder, the marker). It replaces the former «Мини Карта» page
 * (owner, 15.10.2026). While the owner keeps the position off for everybody (src/announcement/features.ts) its blocks are
 * not drawn at all; the item key and the Collector scan stay.
 *
 * Owner, 15.10.2026: the game's screenshot key row went (the game takes the screenshot with its own key, Print Screen
 * by default), and so did «Запускать от имени администратора» (the app always asks for the rights at start,
 * electron/main.ts). «Местоположение на карте» goes under «Клавиши», and the rest of the settings page continues both
 * columns: `left` under them, `right` beside them (owner, 04.11.2026: «Почему этот блок стоит где-то снизу посередине
 * сдвинь его выше»: a grid of its own under this one left a gap under «Поддержка»).
 */
export function RaidToolsSettings({ left, right }: { left?: ReactNode; right?: ReactNode }) {
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
      {!tracking && features.known && (
        <p className="exp-overlay-off muted" role="note">
          {uiText(TRACKING_OFF_FOR_ALL)}{' '}
          <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} aria-hidden="true" /> Telegram</a>
        </p>
      )}
      {/* The player's «Отключить местоположение» card and the «Проверка точки на карте» diagnostics are gone (owner,
          16.10.2026: «зачеркнутое красным УДАЛИТЬ, СРОЧНО»); the position is switched for everybody in «Админ панель». */}
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
            </div>
          </div>
        </section>
      )}

      <div className={`settings-grid${tracking || right ? '' : ' is-single'}`}>
        <div className="raid-tools-stack">
          <section className="panel">
            <div className="panel-header"><div className="panel-title">{uiText('Клавиши')}</div></div>
            <div className="panel-body">
              <HotkeyRow
                label="Клавиша информации о предмете"
                help="itemKey"
                value={settings?.itemKey ?? 'Semicolon'}
                taken={[settings?.collectorKey]}
                onChange={(itemKey) => update({ itemKey })}
              />
              <HotkeyRow
                label="Клавиша обнаружения предметов для коллекционера и убежища"
                help="collectorKey"
                value={settings?.collectorKey ?? ''}
                taken={[settings?.itemKey]}
                onChange={(collectorKey) => update({ collectorKey })}
              />
              {/* «Настройка экрана»: on/off and the next preset (owner, 28.10.2026: «клавиши сюда добавь»). */}
              <PresetKeyRows />
            </div>
          </section>

          {tracking && <section className="panel exp-side">
            <div className="panel-header"><div className="panel-title">{uiText('Местоположение на карте')}</div></div>
            <div className="panel-body exp-status">
              <div className="setting-row">
                <span>
                  <strong>{uiText('Обозначение игрока')}<SettingHelp id="playerMarker" /></strong>
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
                <strong>{uiText('Папка со скриншотами')}<SettingHelp id="screenshotsFolder" /></strong>
                <span className="muted">{status?.screenshotsFolder ?? '…'}{uiText(folderNote)}</span>
                <span className="exp-folder-actions">
                  <button className="button ghost small" onClick={() => void perform(() => api.pickScreenshotsFolder(), setSettings)}>{uiText('Выбрать папку со скриншотами')}</button>
                  <button className="button ghost small" onClick={() => update({ screenshotsDir: '' })}>{uiText('Определить автоматически')}</button>
                </span>
              </div>
            </div>
          </section>}
          {left}
        </div>
        {right && <div className="raid-tools-stack">{right}</div>}
      </div>
    </section>
  )
}

/** The modifiers held in a keyboard or mouse event. */
function heldModifiers(event: KeyboardEvent | MouseEvent): HotkeyModifier[] {
  return [event.ctrlKey && 'Ctrl', event.shiftKey && 'Shift', event.altKey && 'Alt'].filter(Boolean) as HotkeyModifier[]
}
const MODIFIER_CODES = /^(Control|Shift|Alt)(Left|Right)$/

/**
 * A hotkey: one key, or a combination (owner, 10.11.2026: «либо одна клавиша, либо комбинация… зажали Ctrl, держат и
 * нажимают ЛКМ»). A combination is Ctrl, Shift or Alt held with a key or any mouse button (src/overlay/hotkeys.ts).
 */
function HotkeyRow({ label, help, hint, value, taken = [], onChange }: { label: string; help: SettingHelpId; hint?: string; value: string; taken?: Array<string | undefined>; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  // The mode picked while a key is being chosen; otherwise the bound key's own (with «+»: a combination).
  const [comboChoice, setComboChoice] = useState<boolean | null>(null)
  const combo = comboChoice ?? isComboHotkey(value)
  const [held, setHeld] = useState<HotkeyModifier[]>([])
  const stop = () => { setListening(false); setHeld([]); setComboChoice(null) }

  useEffect(() => {
    if (!listening) return
    const pick = (code: string) => {
      if (taken.includes(code)) { setError('Эта клавиша уже занята другой функцией.'); return }
      setError('')
      stop()
      onChange(code)
    }
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') { stop(); setError(''); return }
      if (combo) {
        const modifiers = heldModifiers(event)
        setHeld(modifiers)
        if (MODIFIER_CODES.test(event.code)) return
        if (!modifiers.length) { setError('Зажмите Ctrl, Shift или Alt и нажмите клавишу или кнопку мыши.'); return }
        if (!Object.hasOwn(HOTKEYS, event.code) || event.code.startsWith('Mouse')) { setError('Эту клавишу назначить нельзя. Подойдут буквы, цифры, F1–F12, знаки и кнопки мыши.'); return }
        pick(hotkeyCode(modifiers, event.code))
        return
      }
      if (!isKnownHotkey(event.code)) { setError('Эту клавишу назначить нельзя. Подойдут буквы, цифры, F1–F12, знаки и кнопки мыши 4, 5 и колесо.'); return }
      pick(event.code)
    }
    const onKeyUp = (event: KeyboardEvent) => { if (combo) setHeld(heldModifiers(event)) }
    // Single key: the side buttons 4 / 5 and the wheel click (left and right stay for the page). A combination: any
    // mouse button with a modifier held; a plain left click still works on the page (to cancel).
    const mouseCode = (event: MouseEvent) => combo ? (heldModifiers(event).length ? comboMouseHotkey(event.button) : null) : mouseHotkey(event.button)
    const onMouse = (event: MouseEvent) => {
      const code = mouseCode(event)
      if (!code) return
      event.preventDefault()
      event.stopPropagation()
      pick(combo ? hotkeyCode(heldModifiers(event), code) : code)
    }
    const swallow = (event: MouseEvent) => { if (mouseCode(event)) { event.preventDefault(); event.stopPropagation() } }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('mousedown', onMouse, true)
    window.addEventListener('mouseup', swallow, true)
    window.addEventListener('auxclick', swallow, true)
    window.addEventListener('click', swallow, true)
    window.addEventListener('contextmenu', swallow, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('mouseup', swallow, true)
      window.removeEventListener('auxclick', swallow, true)
      window.removeEventListener('click', swallow, true)
      window.removeEventListener('contextmenu', swallow, true)
    }
  }, [listening, combo, taken, onChange])

  const chooseMode = (next: boolean) => {
    setError('')
    setComboChoice(next)
    setHeld([])
    setListening(true)
  }
  const prompt = combo
    ? (held.length ? `${held.join(' + ')} + …` : 'Зажмите Ctrl, Shift или Alt и нажмите клавишу или кнопку мыши · Esc — отмена')
    : 'Нажмите клавишу или кнопку мыши 4, 5, колесо · Esc — отмена'

  return (
    <div className="setting-row exp-hotkey">
      <span>
        <strong>{uiText(label)}<SettingHelp id={help} /></strong>
        {/* No description under the key (owner, 28.10.2026: «все описания убери»): only while picking or on an error. */}
        {(error || listening || hint) && <small className={error ? 'is-error' : ''}>{uiText(error || (listening ? prompt : hint ?? ''))}</small>}
      </span>
      <span className="hotkey-controls">
        <span className="segmented-filter hotkey-mode" role="group" aria-label={uiText('Вид клавиши')}>
          <button type="button" className={combo ? '' : 'active'} aria-pressed={!combo} onClick={() => chooseMode(false)}>{uiText('Клавиша')}</button>
          <button type="button" className={combo ? 'active' : ''} aria-pressed={combo} onClick={() => chooseMode(true)}>{uiText('Комбинация')}</button>
        </span>
        <button type="button" className={`button ${listening ? 'primary' : 'ghost'} hotkey-button`} onClick={() => { setError(''); if (listening) stop(); else setListening(true) }}>
          <kbd>{listening ? '…' : value ? hotkeyLabel(value, uiText) : uiText('не назначена')}</kbd>
        </button>
      </span>
    </div>
  )
}
