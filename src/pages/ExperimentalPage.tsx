import { uiText } from '../i18n/renderText'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Crosshair, Keyboard, Map as MapIcon, MousePointer2 } from 'lucide-react'
import type { ExperimentalSettings, ExperimentalStatus } from '../overlay/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { hotkeyLabel, isKnownHotkey } from '../overlay/hotkeys'

const DISPLAY_LABEL: Record<ExperimentalStatus['displayMode'], string> = {
  exclusive: 'эксклюзивный полноэкранный',
  fullscreen: 'полноэкранный (окна поверх видны)',
  normal: 'оконный',
  unknown: 'определится, когда игра будет на переднем плане',
}

const DISPLAY_HINT: Record<ExperimentalStatus['displayMode'], string> = {
  exclusive: 'Игра сейчас в эксклюзивном полноэкранном режиме: Windows не показывает поверх неё никакие окна — ни наши, ни TarkovRaidCompass, ни TarkovQuestie. Выберите в настройках графики EFT «Оконный без рамки» (Borderless) или «Полноэкранный» и проверьте, что в свойствах EscapeFromTarkov.exe → Совместимость НЕ отмечено «Отключить оптимизацию во весь экран». До этого цена предмета озвучивается голосом.',
  fullscreen: 'Игра в полноэкранном режиме с оптимизацией Windows — мини-карта и карточка предмета показываются поверх игры.',
  normal: 'Мини-карта и карточка предмета показываются поверх игры.',
  unknown: 'Окна поверх игры работают в режимах «Оконный без рамки» и «Полноэкранный» (с оптимизацией Windows, как у TarkovRaidCompass). Режим экрана определится автоматически, когда игра будет на переднем плане.',
}

const SPEAK_OPTIONS: Array<{ id: ExperimentalSettings['speakItem']; label: string }> = [
  { id: 'off', label: 'Нет' },
  { id: 'exclusive', label: 'Если окна не видны' },
  { id: 'always', label: 'Всегда' },
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
              <p>{uiText(DISPLAY_HINT[status?.displayMode ?? 'unknown'])}</p>
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
                <div className="setting-row">
                  <span>
                    <strong>{uiText("Карточка предмета держится")}</strong>
                    <small>{uiText(((settings?.itemHideMs ?? 6000) / 1000).toFixed(0))}{uiText(" с поверх игры")}</small>
                  </span>
                  <input type="range" min={3000} max={15000} step={1000} value={settings?.itemHideMs ?? 6000} onChange={(event) => update({ itemHideMs: Number(event.target.value) })} />
                </div>
                <div className="setting-row">
                  <span>
                    <strong>{uiText("Озвучивать цену")}</strong>
                    <small>{uiText("Голосом Windows: слышно даже в эксклюзивном полноэкранном режиме, где окна поверх игры не видны.")}</small>
                  </span>
                  <div className="locale-switch">
                    {SPEAK_OPTIONS.map((option) => <button key={option.id} className={(settings?.speakItem ?? 'exclusive') === option.id ? 'active' : ''} onClick={() => update({ speakItem: option.id })}>{uiText(option.label)}</button>)}
                  </div>
                </div>
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
                <p className="muted exp-folder">{uiText("Папка скриншотов: ")}{uiText(status?.screenshotsFolder ?? '…')}</p>
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
