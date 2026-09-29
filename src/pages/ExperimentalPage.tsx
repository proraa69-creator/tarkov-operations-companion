import { uiText } from '../i18n/renderText'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Camera, Crosshair, Keyboard, ListChecks, Map as MapIcon, MousePointer2, ShieldAlert } from 'lucide-react'
import type { ExperimentalSettings, ExperimentalStatus, ScreenshotCheck, ScreenshotKeyInfo } from '../overlay/types'
import { parseScreenshotPosition, type PlayerPosition } from '../overlay/screenshotPosition'
import { gameKeyLabel, isPrintScreen, SCREENSHOT_KEY_CHOICES } from '../overlay/gameKeys'
import { hotkeyLabel, isKnownHotkey } from '../overlay/hotkeys'
import { playerMarkerSvg } from '../overlay/playerMarker'

const DISPLAY_LABEL: Record<ExperimentalStatus['displayMode'], string> = {
  exclusive: 'эксклюзивный полноэкранный',
  fullscreen: 'полноэкранный (окна поверх видны)',
  normal: 'оконный',
  unknown: 'определится, когда игра будет на переднем плане',
}

const OVERLAY_NOTE = 'Мини-карта и карточка предмета показываются поверх игры. Для этого в настройках графики игры поставьте режим экрана «Безрамочный».'

const ADMIN_NOTE = 'Лаунчер BSG запускает игру от имени администратора. Пока Tarkov Operator работает без этих прав, Windows скрывает от него клавиши, нажатые в игре, и не пропускает в игру его нажатия: мини-карта по клавише и автоматические скриншоты не срабатывают. Скриншот, который вы делаете сами, мини-карта покажет и так.'

const SNIPPING_NOTE = 'Windows открывает «Ножницы» по клавише PrtSc, и игра эту клавишу не получает. Назначьте в игре другую клавишу скриншота (Настройки → Управление → «Скриншот», например F12) — приложение прочитает её само, — или отключите в Windows «Использовать клавишу Print Screen для открытия функции создания фрагмента экрана».'

const KEY_SOURCE: Record<ScreenshotKeyInfo['source'], string> = {
  setting: 'выбрана вручную',
  'game-settings': 'из настроек игры',
  'game-log': 'из журнала игры',
  default: 'по умолчанию: в настройках игры не найдена',
}

const PLAYER_MARKERS: Array<{ id: ExperimentalSettings['playerMarker']; label: string }> = [
  { id: 'arrow', label: 'Стрелка' },
  { id: 'chevron', label: 'Шеврон' },
  { id: 'dot', label: 'Точка' },
]

/** «x −230.9 · y 3.6 · z −375.8 · 200°» */
function positionText(position: PlayerPosition) {
  return `x ${position.x.toFixed(1)} · y ${position.y.toFixed(1)} · z ${position.z.toFixed(1)} · ${Math.round((position.yaw + 360) % 360)}°`
}

function keyText(key?: ScreenshotKeyInfo) {
  if (!key) return '…'
  if (key.unbound) return uiText('в игре не назначена')
  if (!key.sendable) return `${key.label} — ${uiText('кнопка мыши, приложение не может её нажать')}`
  return `${key.label} (${uiText(KEY_SOURCE[key.source])})`
}

export function ExperimentalPage() {
  const api = window.tarkovDesktop?.experimental
  const [settings, setSettings] = useState<ExperimentalSettings | null>(null)
  const [status, setStatus] = useState<ExperimentalStatus | null>(null)
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [check, setCheck] = useState<ScreenshotCheck | null>(null)
  const [adminRefused, setAdminRefused] = useState(false)

  useEffect(() => {
    if (!api) return
    void api.getSettings().then(setSettings)
    const refresh = () => void api.getStatus().then((next) => {
      setNow(Date.now())
      setStatus(next)
      if (next.lastPosition) setPosition(next.lastPosition)
    })
    refresh()
    const timer = window.setInterval(refresh, 2000)
    const off = api.onPosition(setPosition)
    const offCheck = api.onCheckProgress?.(setCheck)
    return () => { window.clearInterval(timer); off(); offCheck?.() }
  }, [api])

  const update = (patch: Partial<ExperimentalSettings>) => {
    if (!api || !settings) return
    setSettings({ ...settings, ...patch })
    void api.updateSettings(patch).then(setSettings)
  }

  const runCheck = () => {
    if (!api || (check && check.phase !== 'done')) return
    setCheck(null)
    void api.checkScreenshots().then(setCheck)
  }

  const restartAsAdmin = () => {
    setAdminRefused(false)
    void api?.relaunchAsAdmin().then((started) => setAdminRefused(!started))
  }

  const lastShot = status?.lastScreenshot ? parseScreenshotPosition(status.lastScreenshot.name, status.lastScreenshot.at) : null
  const snippingConflict = Boolean(status && isPrintScreen(status.screenshotKey.keys) && status.snipping === 'on')
  const checking = Boolean(check && check.phase !== 'done')

  return (
    <div className="page experimental-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText("Окна поверх игры")}</div>
          <h1 className="page-title">{uiText("Мини Карта")}</h1>
          <p className="page-subtitle">{uiText("Функции поверх игры. Они только читают экран и файлы скриншотов — в игру ничего не внедряется.")}</p>
        </div>
      </header>

      {uiText(!api ? (
        <section className="panel"><div className="panel-body">{uiText("Эти функции работают только в приложении для Windows.")}</div></section>
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
              <div className="panel-header"><div className="panel-title">{uiText("Функции")}</div></div>
              <div className="panel-body">
                <Toggle
                  icon={<MousePointer2 size={16} />}
                  title={uiText("Информация о предмете")}
                  hint="Наведите курсор на предмет, дождитесь подсказки с названием и нажмите клавишу: цена на барахолке, лучшая цена торговца и нужен ли предмет для заданий и «Коллекционера»."
                  on={Boolean(settings?.itemLookup)}
                  onChange={(itemLookup) => update({ itemLookup })}
                />
                <HotkeyRow
                  label="Клавиша информации о предмете"
                  value={settings?.itemKey ?? 'Semicolon'}
                  taken={[settings?.minimapKey, settings?.collectorKey]}
                  onChange={(itemKey) => update({ itemKey })}
                />
                <Toggle
                  icon={<MapIcon size={16} />}
                  title={uiText("Мини-карта")}
                  hint="Карта текущего рейда с выходами, точками текущих квестов и вашей позицией. Позиция берётся из имени файла скриншота EFT (как в TarkovRaidCompass). Повторное нажатие скрывает."
                  on={Boolean(settings?.minimap)}
                  onChange={(minimap) => update({ minimap })}
                />
                <div className="setting-row">
                  <span>
                    <strong>{uiText("Прозрачность мини-карты")}</strong>
                    <small>{uiText(`${Math.round((settings?.minimapOpacity ?? 0.9) * 100)}%`)}</small>
                  </span>
                  <input type="range" min={30} max={100} step={5} value={Math.round((settings?.minimapOpacity ?? 0.9) * 100)} onChange={(event) => update({ minimapOpacity: Number(event.target.value) / 100 })} />
                </div>
                <div className="setting-row">
                  <span>
                    <strong>{uiText("Обозначение игрока")}</strong>
                    <small>{uiText("Как показывать вашу позицию на картах")}</small>
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
                  value={settings?.minimapKey ?? 'KeyM'}
                  taken={[settings?.itemKey, settings?.collectorKey]}
                  onChange={(minimapKey) => update({ minimapKey })}
                />
                <HotkeyRow
                  label="Клавиша сканирования предметов «Коллекционера»"
                  value={settings?.collectorKey ?? ''}
                  taken={[settings?.itemKey, settings?.minimapKey]}
                  optional
                  onChange={(collectorKey) => update({ collectorKey })}
                />
                <Toggle
                  icon={<Crosshair size={16} />}
                  title={uiText("Позиция по скриншотам")}
                  hint="Скриншот EFT хранит координаты в имени файла. Нажимайте в рейде клавишу скриншота игры (по умолчанию PrtSc) или включите автоматические скриншоты. Снимки не удаляются."
                  on={Boolean(settings?.tracking)}
                  onChange={(tracking) => update({ tracking })}
                />
                <Toggle
                  icon={<Camera size={16} />}
                  title={uiText("Показывать мини-карту при скриншоте")}
                  hint="Когда вы сами делаете скриншот в рейде, мини-карта открывается на 15 секунд с вашей позицией. Работает и без прав администратора."
                  on={Boolean(settings?.showOnScreenshot)}
                  disabled={!settings?.tracking || !settings?.minimap}
                  onChange={(showOnScreenshot) => update({ showOnScreenshot })}
                />
                <Toggle
                  icon={<Keyboard size={16} />}
                  title={uiText("Автоматические скриншоты")}
                  hint="В рейде, пока игра на переднем плане, приложение само нажимает клавишу скриншота игры. Это эмуляция клавиши — используйте на свой риск."
                  on={Boolean(settings?.autoScreenshot)}
                  disabled={!settings?.tracking}
                  onChange={(autoScreenshot) => update({ autoScreenshot })}
                />
                {uiText(settings?.autoScreenshot ? (
                  <div className="setting-row">
                    <span>
                      <strong>{uiText("Интервал")}</strong>
                      <small>{uiText((settings.screenshotIntervalMs / 1000).toFixed(1))}{uiText(" с между снимками")}</small>
                    </span>
                    <input
                      type="range"
                      min={1000}
                      max={2000}
                      step={250}
                      value={settings.screenshotIntervalMs}
                      onChange={(event) => update({ screenshotIntervalMs: Number(event.target.value) })}
                    />
                  </div>
                ) : null)}
                <div className="setting-row">
                  <span>
                    <strong>{uiText("Клавиша скриншота")}</strong>
                    <small>{uiText("Её нажимает приложение. Должна совпадать с клавишей «Скриншот» в настройках управления игры — обычно её лучше взять из игры.")}</small>
                  </span>
                  <select className="select" value={settings?.screenshotKey ?? ''} onChange={(event) => update({ screenshotKey: event.target.value })}>
                    <option value="">{uiText("Как в игре")}</option>
                    {SCREENSHOT_KEY_CHOICES.map((key) => <option key={key} value={key}>{gameKeyLabel([key])}</option>)}
                  </select>
                </div>
                <Toggle
                  icon={<ShieldAlert size={16} />}
                  title={uiText("Запускать от имени администратора")}
                  hint="Игра работает с правами администратора, поэтому приложению нужны такие же, чтобы видеть клавиши в игре и нажимать клавишу скриншота. Windows спросит разрешение при запуске."
                  on={Boolean(settings?.runAsAdmin)}
                  onChange={(runAsAdmin) => update({ runAsAdmin })}
                />
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><div className="panel-title">{uiText("Состояние")}</div></div>
              <div className="panel-body exp-status">
                <Row label="Горячие клавиши" value={status?.hookReady ? 'работают' : status?.hookError ? `ошибка: ${status.hookError}` : '…'} ok={status?.hookReady} />
                <Row label="Права администратора" value={status?.elevated ? 'есть' : status?.elevated === false ? 'нет' : '…'} ok={Boolean(status?.elevated)} />
                <Row
                  label="Окно игры"
                  value={status?.gameSeenAt ? `на переднем плане ${Math.max(0, Math.round((now - status.gameSeenAt) / 1000))} с назад` : 'не было на переднем плане'}
                  ok={Boolean(status?.gameSeenAt)}
                />
                <Row
                  label="Клавиши, нажатые в игре"
                  value={status?.gameKeys === 'visible' ? 'видны' : status?.gameKeys === 'hidden' ? 'не видны — Windows скрывает их' : 'проверится во время игры'}
                  ok={status?.gameKeys === 'visible'}
                />
                <Row label="Клавиша скриншота в игре" value={keyText(status?.screenshotKey)} ok={Boolean(status?.screenshotKey.sendable && status.screenshotKey.source !== 'default')} />
                {snippingConflict && (
                  <div className="exp-note is-alert">
                    <p>{uiText(SNIPPING_NOTE)}</p>
                    <button className="button ghost small" onClick={() => void api.openKeyboardSettings()}>{uiText("Открыть настройки клавиатуры Windows")}</button>
                  </div>
                )}
                <Row
                  label="Нажатий клавиши скриншота приложением"
                  value={`${status?.screenshotPresses ?? 0} · снимков после них: ${status?.filesAfterPress ?? 0}`}
                  ok={(status?.filesAfterPress ?? 0) > 0}
                />
                <Row
                  label="Последний скриншот"
                  value={status?.lastScreenshot ? `${status.lastScreenshot.withCoordinates ? 'с координатами' : 'БЕЗ координат'} · ${Math.max(0, Math.round((now - status.lastScreenshot.at) / 1000))} с назад` : 'новых скриншотов нет'}
                  ok={Boolean(status?.lastScreenshot?.withCoordinates)}
                />
                {lastShot && <p className="muted exp-folder">{uiText('Из имени файла: ')}{positionText(lastShot)}</p>}
                {status?.lastScreenshot && !status.lastScreenshot.withCoordinates && <p className="muted exp-folder">{uiText('Файл: ')}{status.lastScreenshot.name}{uiText(' — в имени нет координат. Проверьте, что скриншот сделан в рейде, и пришлите имя файла разработчику.')}</p>}
                <Row label="Режим экрана игры" value={DISPLAY_LABEL[status?.displayMode ?? 'unknown']} ok={status?.displayMode === 'fullscreen' || status?.displayMode === 'normal'} />
                <Row label="Рейд" value={status?.raid.inRaid ? `в рейде${status.raid.location ? ` · ${status.raid.location}` : ''}` : 'в меню'} ok={status?.raid.inRaid} />
                <Row label="Отслеживание" value={status?.tracking ? 'включено' : 'выключено'} ok={status?.tracking} />
                <Row
                  label="Последняя позиция"
                  value={position ? `x ${position.x.toFixed(1)} · z ${position.z.toFixed(1)} · ${Math.max(0, Math.round((now - position.at) / 1000))} с назад` : 'ещё нет'}
                  ok={Boolean(position)}
                />
                <div className="exp-folder">
                  <span className="muted">{uiText("Папка скриншотов: ")}{uiText(status?.screenshotsFolder ?? '…')}{uiText(settings?.screenshotsDir ? ' (выбрана вручную)' : ' (найдена автоматически)')}</span>
                  <span className="exp-folder-actions">
                    <button className="button ghost small" onClick={() => void api.pickScreenshotsFolder().then(setSettings)}>{uiText("Выбрать папку")}</button>
                    {settings?.screenshotsDir ? <button className="button ghost small" onClick={() => update({ screenshotsDir: '' })}>{uiText("Авто")}</button> : null}
                  </span>
                  <small className="muted">{uiText("EFT сохраняет скриншоты в «Документы\\Escape from Tarkov\\Screenshots»; в имени файла — координаты. Позиция появится после первого скриншота в рейде (клавиша скриншота игры или клавиша мини-карты).")}</small>
                </div>
                <div className="exp-actions">
                  <button className="button primary" onClick={() => void api.testItemLookup()}>{uiText("Проверить карточку предмета")}</button>
                  <button className="button ghost" onClick={() => void api.toggleMinimap()}>{uiText("Показать / скрыть мини-карту")}</button>
                </div>
              </div>
            </section>
          </div>

          <section className="panel exp-check-panel">
            <div className="panel-header">
              <div className="panel-title"><ListChecks size={16} />{uiText("Проверка скриншотов")}</div>
              <button className="button primary" disabled={checking} onClick={runCheck}>{uiText(checking ? 'Проверяю…' : 'Проверить скриншоты')}</button>
            </div>
            <div className="panel-body">
              <p className="muted exp-check-intro">{uiText("Приложение найдёт папку скриншотов и клавишу скриншота, прочитает координаты из последнего снимка, затем дождётся, пока вы переключитесь в игру (лучше в рейде), нажмёт клавишу и проверит, появился ли новый снимок и есть ли в его имени координаты.")}</p>
              {check && <CheckList check={check} />}
            </div>
          </section>
        </>
      ))}
    </div>
  )
}

type StepState = 'ok' | 'warn' | 'fail' | 'wait'
interface CheckStep { id: string; state: StepState; label: string; detail: string }

const STEP_MARK: Record<StepState, string> = { ok: '✓', warn: '!', fail: '✕', wait: '…' }

/** The self-check as a list of steps, filled in while it runs. */
function checkSteps(check: ScreenshotCheck): CheckStep[] {
  const { folder, key, file } = check
  const steps: CheckStep[] = [
    {
      id: 'folder',
      label: 'Папка скриншотов игры',
      state: folder.exists ? 'ok' : 'warn',
      detail: folder.exists
        ? `${folder.path} · ${uiText('снимков:')} ${folder.images} · ${uiText('с координатами:')} ${folder.withCoordinates}`
        : `${folder.path} · ${uiText('папки ещё нет: игра сюда скриншоты не сохраняла')}`,
    },
    {
      id: 'coordinates',
      label: 'Координаты из имени последнего снимка',
      state: folder.newest?.position ? 'ok' : 'warn',
      detail: folder.newest?.position ? `${folder.newest.name} → ${positionText(folder.newest.position)}` : uiText('снимков с координатами нет: игра пишет их только в рейде'),
    },
    { id: 'key', label: 'Клавиша скриншота', state: !key.sendable ? 'fail' : key.source === 'default' ? 'warn' : 'ok', detail: keyText(key) },
  ]
  if (isPrintScreen(key.keys)) {
    steps.push({
      id: 'snipping',
      label: '«Ножницы» Windows на PrtSc',
      state: check.snipping === 'on' ? 'fail' : check.snipping === 'off' ? 'ok' : 'warn',
      detail: uiText(check.snipping === 'on' ? 'включены: Windows забирает PrtSc у игры' : check.snipping === 'off' ? 'выключены' : 'не удалось проверить'),
    })
  }
  steps.push({
    id: 'admin',
    label: 'Права администратора',
    state: check.elevated ? 'ok' : 'warn',
    detail: uiText(check.elevated ? 'есть' : check.elevated === false ? 'нет: если игра запущена от администратора, Windows не пропустит нажатие' : 'неизвестно'),
  })
  if (check.verdict === 'no-native' || check.verdict === 'no-key' || check.verdict === 'snipping') return steps
  if (check.phase === 'running') return steps
  const reached = check.pressed || Boolean(file)
  steps.push({
    id: 'game',
    label: 'Игра на переднем плане',
    state: check.phase === 'waiting-game' ? 'wait' : reached ? 'ok' : 'fail',
    detail: check.phase === 'waiting-game'
      ? `${uiText('переключитесь в игру (лучше в рейде), осталось')} ${check.countdown} ${uiText('сек.')}`
      : uiText(reached ? 'игра на переднем плане' : 'игра не появилась на переднем плане за 20 с'),
  })
  if (check.phase === 'waiting-game' || !reached) return steps
  steps.push({
    id: 'press',
    label: 'Нажатие клавиши',
    state: 'ok',
    detail: check.pressed ? `${uiText('приложение нажало')} ${key.label}` : uiText('вы сделали скриншот сами'),
  })
  steps.push({
    id: 'file',
    label: 'Новый скриншот',
    state: file ? 'ok' : check.phase === 'waiting-file' ? 'wait' : 'fail',
    detail: file ? file.name : uiText(check.phase === 'waiting-file' ? 'ждём файл от игры…' : 'игра не сохранила снимок за 6 с'),
  })
  if (file) {
    steps.push({
      id: 'file-coordinates',
      label: 'Координаты нового скриншота',
      state: file.position ? 'ok' : 'fail',
      detail: file.position ? positionText(file.position) : uiText('в имени нет координат: снимок сделан не в рейде'),
    })
  }
  return steps
}

function verdictText(check: ScreenshotCheck) {
  const { key } = check
  switch (check.verdict) {
    case 'ok': return uiText('Всё работает: игра сохраняет скриншоты, и из имени файла читается ваша позиция — мини-карта её покажет.')
    case 'no-native': return `${uiText('Не загрузились функции Windows — приложение не видит окно игры. Пришлите этот текст разработчику:')} ${check.nativeError}`
    case 'no-key': return key.unbound
      ? uiText('В игре не назначена клавиша скриншота. Назначьте её в игре (Настройки → Управление → «Скриншот») или выберите клавишу скриншота выше.')
      : uiText('Скриншот в игре назначен на кнопку мыши — приложение не может её нажать. Назначьте в игре клавишу клавиатуры.')
    case 'snipping': return uiText(SNIPPING_NOTE)
    case 'no-game': return uiText('Игра не появилась на переднем плане за 20 секунд. Нажмите «Проверить скриншоты» и сразу переключитесь в игру.')
    case 'no-file': return check.elevated === false
      ? uiText('Клавиша нажата, но игра не сохранила скриншот. Скорее всего, игра запущена от имени администратора и Windows не пропускает к ней нажатия приложения. Перезапустите приложение от имени администратора и повторите проверку.')
      : key.source === 'default'
        ? uiText('Клавиша нажата, но игра не сохранила скриншот. Клавишу скриншота не удалось прочитать из настроек игры — выберите её выше так же, как в игре.')
        : `${uiText('Клавиша нажата, но игра не сохранила скриншот. Проверьте, что в игре скриншот назначен на')} ${key.label}${uiText(', и что папка скриншотов выбрана верно.')}`
    case 'no-coordinates': return uiText('Скриншот появился, но в его имени нет координат: игра пишет их только в рейде. Повторите проверку в рейде.')
    default: return ''
  }
}

function CheckList({ check }: { check: ScreenshotCheck }) {
  const steps = checkSteps(check)
  return (
    <div className="exp-check">
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={`exp-check-step is-${step.state}`}>
            <span className="exp-check-mark" aria-hidden="true">{STEP_MARK[step.state]}</span>
            <span>
              <strong>{uiText(step.label)}</strong>
              <small>{step.detail}</small>
            </span>
          </li>
        ))}
      </ol>
      {check.verdict && <p className={`exp-verdict ${check.verdict === 'ok' ? 'is-ok' : 'is-fail'}`}>{verdictText(check)}</p>}
    </div>
  )
}

function Toggle({ icon, title, hint, on, disabled, onChange }: { icon: ReactNode; title: string; hint: string; on: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className={`setting-row exp-toggle${disabled ? ' is-disabled' : ''}`}>
      <span>
        <strong>{uiText(icon)}{uiText(title)}</strong>
        <small>{uiText(hint)}</small>
      </span>
      <button className={`toggle ${on ? 'on' : ''}`} disabled={disabled} aria-pressed={on} aria-label={uiText(title)} onClick={() => onChange(!on)}>
        <span />
      </button>
    </div>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="exp-row">
      <span>{uiText(label)}</span>
      <strong className={ok ? 'is-ok' : ''}>{uiText(value)}</strong>
    </div>
  )
}

function HotkeyRow({ label, value, taken = [], optional, onChange }: { label: string; value: string; taken?: Array<string | undefined>; optional?: boolean; onChange: (code: string) => void }) {
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
        <small className={error ? 'is-error' : ''}>{uiText(error || (listening ? 'Нажмите нужную клавишу · Esc — отмена' : 'Работает, пока игра на переднем плане'))}</small>
      </span>
      <button type="button" className={`button ${listening ? 'primary' : 'ghost'} hotkey-button`} onClick={() => { setError(''); setListening((state) => !state) }}>
        <kbd>{uiText(listening ? '…' : value ? hotkeyLabel(value) : 'выкл.')}</kbd>
      </button>
      {optional && value && !listening && <button type="button" className="button ghost small" onClick={() => onChange('')}>{uiText('Отключить')}</button>}
    </div>
  )
}
