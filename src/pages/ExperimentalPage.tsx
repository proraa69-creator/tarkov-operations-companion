import { uiText } from '../i18n/renderText'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import type { ExperimentalSettings, ExperimentalStatus, ScreenshotKeyInfo } from '../overlay/types'
import { gameKeyLabel, isPrintScreen, SCREENSHOT_KEY_CHOICES } from '../overlay/gameKeys'
import { hotkeyLabel, isKnownHotkey } from '../overlay/hotkeys'
import { playerMarkerSvg } from '../overlay/playerMarker'
import './experimentalPage.css'

const OVERLAY_NOTE = 'Мини-карта и карточка предмета показываются поверх игры. Для этого в настройках графики поставьте режим экрана «Безрамочный».'

const ADMIN_NOTE = 'Лаунчер BSG запускает игру от имени администратора. Пока Raid OS работает без этих прав, Windows скрывает от него клавиши, нажатые в игре, и не пропускает в игру его нажатия: мини-карта и карточка предмета по клавише не срабатывают. Скриншот, который вы делаете сами, мини-карта покажет и так.'

const SNIPPING_NOTE = 'Windows открывает «Ножницы» по клавише PrtSc, и игра эту клавишу не получает. Назначьте в игре другую клавишу скриншота (Настройки → Управление → «Скриншот», например F12) — приложение прочитает её само, — или отключите в Windows «Использовать клавишу Print Screen для открытия функции создания фрагмента экрана».'

const SCREENSHOT_KEY_USE = 'Приложение нажимает её один раз, когда вы открываете мини-карту, — так на карте появляется ваша позиция.'

const PLAYER_MARKERS: Array<{ id: ExperimentalSettings['playerMarker']; label: string }> = [
  { id: 'arrow', label: 'Стрелка' },
  { id: 'chevron', label: 'Шеврон' },
  { id: 'dot', label: 'Точка' },
]

/** Which screenshot key is used and where it came from, in one short line. */
function screenshotKeyText(key: ExperimentalStatus['screenshotKey'] | undefined) {
  if (!key) return uiText('Определяю клавишу скриншота…')
  if (key.unbound) return uiText('В игре клавиша скриншота не назначена. Назначьте её в игре (Настройки → Управление → «Скриншот»).')
  if (!key.sendable) return `${uiText('В игре скриншот назначен на')} ${key.label}${uiText(': это кнопка мыши, приложение не может её нажать. Назначьте в игре клавишу клавиатуры.')}`
  const source: Record<ScreenshotKeyInfo['source'], string> = {
    setting: 'Выбрана вручную:',
    'game-settings': 'Определена по настройкам игры:',
    'game-log': 'Определена по журналу игры:',
    default: 'В настройках игры не найдена, сейчас:',
  }
  return `${uiText(source[key.source])} ${key.label}`
}

export function ExperimentalPage() {
  const api = window.tarkovDesktop?.experimental
  const [settings, setSettings] = useState<ExperimentalSettings | null>(null)
  const [status, setStatus] = useState<ExperimentalStatus | null>(null)
  const [adminRefused, setAdminRefused] = useState(false)

  useEffect(() => {
    if (!api) return
    void api.getSettings().then(setSettings)
    const refresh = () => void api.getStatus().then(setStatus)
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => window.clearInterval(timer)
  }, [api])

  const update = (patch: Partial<ExperimentalSettings>) => {
    if (!api || !settings) return
    setSettings({ ...settings, ...patch })
    void api.updateSettings(patch).then(setSettings)
  }

  const restartAsAdmin = () => {
    setAdminRefused(false)
    void api?.relaunchAsAdmin().then((started) => setAdminRefused(!started))
  }

  const snippingConflict = Boolean(status && isPrintScreen(status.screenshotKey.keys) && status.snipping === 'on')
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
          <section className={`panel exp-warning${status?.displayMode === 'exclusive' ? ' is-alert' : ''}`}>
            <div className="panel-body">
              <AlertTriangle size={18} />
              <p>{uiText(OVERLAY_NOTE)}{status?.displayMode === 'exclusive' ? <strong>{uiText(' Сейчас игра в эксклюзивном полноэкранном режиме — окна поверх неё не видны.')}</strong> : null}</p>
            </div>
          </section>

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

          <div className="settings-grid">
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
                <div className="setting-row">
                  <span>
                    <strong>{uiText('Прозрачность мини-карты')}</strong>
                    <small>{`${Math.round((settings?.minimapOpacity ?? 0.9) * 100)}%`}</small>
                  </span>
                  <input type="range" min={30} max={100} step={5} value={Math.round((settings?.minimapOpacity ?? 0.9) * 100)} onChange={(event) => update({ minimapOpacity: Number(event.target.value) / 100 })} />
                </div>
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
                <HotkeyRow
                  label="Клавиша мини-карты"
                  hint="Показывает и скрывает мини-карту в рейде."
                  value={settings?.minimapKey ?? 'KeyM'}
                  taken={[settings?.itemKey, settings?.collectorKey]}
                  onChange={(minimapKey) => update({ minimapKey })}
                />
                <HotkeyRow
                  label="Клавиша сканирования предметов для коллекционера"
                  hint="Поместите все предметы для квеста «Коллекционер» в один контейнер."
                  value={settings?.collectorKey ?? ''}
                  taken={[settings?.itemKey, settings?.minimapKey]}
                  onChange={(collectorKey) => update({ collectorKey })}
                />
                <div className="setting-row exp-screenshot-key">
                  <span>
                    <strong>{uiText('Клавиша скриншота')}</strong>
                    <small className="exp-key-found">{screenshotKeyText(status?.screenshotKey)}</small>
                    <small>{uiText(SCREENSHOT_KEY_USE)}</small>
                  </span>
                  <select className="select" value={settings?.screenshotKey ?? ''} onChange={(event) => update({ screenshotKey: event.target.value })} aria-label={uiText('Клавиша скриншота')}>
                    <option value="">{uiText('Определить автоматически')}</option>
                    {SCREENSHOT_KEY_CHOICES.map((key) => <option key={key} value={key}>{gameKeyLabel([key])}</option>)}
                  </select>
                </div>
                {snippingConflict && (
                  <div className="exp-note is-alert">
                    <p>{uiText(SNIPPING_NOTE)}</p>
                    <button className="button ghost small" onClick={() => void api.openKeyboardSettings()}>{uiText('Открыть настройки клавиатуры Windows')}</button>
                  </div>
                )}
                <Toggle
                  icon={<ShieldAlert size={16} />}
                  title="Запускать от имени администратора"
                  hint="Игра работает с правами администратора, поэтому приложению нужны такие же, чтобы видеть клавиши в игре и нажимать клавишу скриншота. Windows спросит разрешение при запуске."
                  on={Boolean(settings?.runAsAdmin)}
                  onChange={(runAsAdmin) => update({ runAsAdmin })}
                />
              </div>
            </section>

            <section className="panel exp-side">
              <div className="panel-header"><div className="panel-title">{uiText('Папка со скриншотами')}</div></div>
              <div className="panel-body exp-status">
                <div className="exp-folder">
                  <span className="muted">{status?.screenshotsFolder ?? '…'}{uiText(folderNote)}</span>
                  <span className="exp-folder-actions">
                    <button className="button ghost small" onClick={() => void api.pickScreenshotsFolder().then(setSettings)}>{uiText('Выбрать папку со скриншотами')}</button>
                    <button className="button ghost small" onClick={() => update({ screenshotsDir: '' })}>{uiText('Определить автоматически')}</button>
                  </span>
                </div>
                <div className="exp-actions exp-minimap-action">
                  <button className="button ghost" onClick={() => void api.toggleMinimap()}>{uiText('Показать / скрыть мини-карту')}</button>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
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
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') { setListening(false); setError(''); return }
      if (!isKnownHotkey(event.code)) { setError('Эту клавишу назначить нельзя. Подойдут буквы, цифры, F1–F12 и знаки.'); return }
      if (taken.includes(event.code)) { setError('Эта клавиша уже занята другой функцией.'); return }
      setError('')
      setListening(false)
      onChange(event.code)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, taken, onChange])

  return (
    <div className="setting-row exp-hotkey">
      <span>
        <strong>{uiText(label)}</strong>
        <small className={error ? 'is-error' : ''}>{uiText(error || (listening ? 'Нажмите нужную клавишу · Esc — отмена' : hint))}</small>
      </span>
      <button type="button" className={`button ${listening ? 'primary' : 'ghost'} hotkey-button`} onClick={() => { setError(''); setListening((state) => !state) }}>
        <kbd>{listening ? '…' : value ? hotkeyLabel(value) : uiText('не назначена')}</kbd>
      </button>
    </div>
  )
}
