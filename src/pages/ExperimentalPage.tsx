import { uiText } from '../i18n/renderText'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Crosshair, Keyboard, Map as MapIcon, MousePointer2 } from 'lucide-react'
import type { ExperimentalSettings, ExperimentalStatus } from '../overlay/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { hotkeyLabel, isKnownHotkey } from '../overlay/hotkeys'
import { playerMarkerSvg } from '../overlay/playerMarker'

const DISPLAY_LABEL: Record<ExperimentalStatus['displayMode'], string> = {
  exclusive: 'эксклюзивный полноэкранный',
  fullscreen: 'полноэкранный (окна поверх видны)',
  normal: 'оконный',
  unknown: 'определится, когда игра будет на переднем плане',
}

const OVERLAY_NOTE = 'Мини-карта и карточка предмета показываются поверх игры. Для этого в настройках графики игры поставьте режим экрана «Безрамочный».'

const PLAYER_MARKERS: Array<{ id: ExperimentalSettings['playerMarker']; label: string }> = [
  { id: 'arrow', label: 'Стрелка' },
  { id: 'chevron', label: 'Шеврон' },
  { id: 'dot', label: 'Точка' },
]

export function ExperimentalPage() {
  const api = window.tarkovDesktop?.experimental
  const [settings, setSettings] = useState<ExperimentalSettings | null>(null)
  const [status, setStatus] = useState<ExperimentalStatus | null>(null)
  const [position, setPosition] = useState<PlayerPosition | null>(null)
  const [now, setNow] = useState(() => Date.now())

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
    return () => { window.clearInterval(timer); off() }
  }, [api])

  const update = (patch: Partial<ExperimentalSettings>) => {
    if (!api || !settings) return
    setSettings({ ...settings, ...patch })
    void api.updateSettings(patch).then(setSettings)
  }

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
                  hint="Скриншот EFT хранит координаты в имени файла. Нажимайте PrtSc в рейде или включите автоматические скриншоты. Снимки не удаляются."
                  on={Boolean(settings?.tracking)}
                  onChange={(tracking) => update({ tracking })}
                />
                <Toggle
                  icon={<Keyboard size={16} />}
                  title={uiText("Автоматические скриншоты")}
                  hint="В рейде, пока игра на переднем плане, приложение само нажимает PrtSc. Это эмуляция клавиши — используйте на свой риск."
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
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><div className="panel-title">{uiText("Состояние")}</div></div>
              <div className="panel-body exp-status">
                <Row label="Горячие клавиши" value={status?.hookReady ? 'работают' : status?.hookError ? `ошибка: ${status.hookError}` : '…'} ok={status?.hookReady} />
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
                  <small className="muted">{uiText("EFT сохраняет скриншоты в «Документы\\Escape from Tarkov\\Screenshots»; в имени файла — координаты. Позиция появится после первого скриншота в рейде (клавиша PrtSc или клавиша мини-карты).")}</small>
                </div>
                <div className="exp-actions">
                  <button className="button primary" onClick={() => void api.testItemLookup()}>{uiText("Проверить карточку предмета")}</button>
                  <button className="button ghost" onClick={() => void api.toggleMinimap()}>{uiText("Показать / скрыть мини-карту")}</button>
                </div>
              </div>
            </section>
          </div>
        </>
      ))}
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
