import { uiText } from '../i18n/renderText'
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Crosshair, Keyboard, Map as MapIcon, MousePointer2 } from 'lucide-react'
import type { ExperimentalSettings, ExperimentalStatus } from '../overlay/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'

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
          <div className="eyebrow">{uiText("Экспериментальная сборка")}</div>
          <h1 className="page-title">{uiText("Эксперименты")}</h1>
          <p className="page-subtitle">{uiText("Функции поверх игры. Они только читают экран и файлы скриншотов — в игру ничего не внедряется.")}</p>
        </div>
      </header>

      {uiText(!api ? (
        <section className="panel"><div className="panel-body">{uiText("Эти функции работают только в приложении для Windows.")}</div></section>
      ) : (
        <>
          <section className="panel exp-warning">
            <div className="panel-body">
              <AlertTriangle size={18} />
              <p>{uiText(" Окна поверх игры видны только в режиме экрана ")}<strong>{uiText("«Оконный без рамки»")}</strong>{uiText(" (Borderless). В полноэкранном режиме Windows не даёт рисовать поверх игры. ")}</p>
            </div>
          </section>

          <div className="settings-grid">
            <section className="panel">
              <div className="panel-header"><div className="panel-title">{uiText("Функции")}</div></div>
              <div className="panel-body">
                <Toggle
                  icon={<MousePointer2 size={16} />}
                  title={uiText("Информация о предмете — клавиша «Ж»")}
                  hint="Наведите курсор на предмет, дождитесь подсказки с названием и нажмите «Ж»: только цена на барахолке."
                  on={Boolean(settings?.itemLookup)}
                  onChange={(itemLookup) => update({ itemLookup })}
                />
                <Toggle
                  icon={<MapIcon size={16} />}
                  title={uiText("Мини-карта — клавиша «M»")}
                  hint="Показывает карту текущего рейда с выходами и точками текущих квестов. Повторное нажатие скрывает."
                  on={Boolean(settings?.minimap)}
                  onChange={(minimap) => update({ minimap })}
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
