import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Crosshair, Hand, MoveVertical, Play, Square } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { handControl } from './handControlStore'
import { useHandControl } from './edition'
import { DEFAULT_SETTINGS, HAND_BONES, type HandControlSettings } from './types'
import type { TrackerErrorCode } from './webcamTracker'

const ERRORS: Record<TrackerErrorCode, string> = {
  unsupported: 'Камера недоступна в этой среде.',
  denied: 'Доступ к камере запрещён. Разрешите классическим приложениям доступ к камере в параметрах конфиденциальности Windows и попробуйте снова.',
  busy: 'Камера занята другой программой (например OBS). Закройте её или выберите другую камеру.',
  'no-camera': 'Камера не найдена. Подключите веб-камеру или выберите другую.',
  model: 'Не удалось загрузить модель распознавания руки.',
}

const PHASE: Record<string, string> = { idle: 'нет руки', point: 'наведение', press: 'нажатие', scroll: 'прокрутка', grab: 'захват' }

export function HandControlPanel() {
  const snapshot = useHandControl()
  const { status, settings, frame, stats } = snapshot
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [foreground, setForeground] = useState('')
  const desktop = window.tarkovDesktop?.handControl

  useEffect(() => {
    let cancelled = false
    const load = () => void navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
      if (!cancelled) setCameras(devices.filter((device) => device.kind === 'videoinput'))
    })
    load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => { cancelled = true; navigator.mediaDevices?.removeEventListener?.('devicechange', load) }
  }, [status])

  useEffect(() => {
    if (!desktop || status !== 'on') return
    const poll = () => void desktop.foregroundWindow().then(setForeground)
    poll()
    const timer = window.setInterval(poll, 1000)
    return () => window.clearInterval(timer)
  }, [desktop, status])

  const update = (patch: Partial<HandControlSettings>) => handControl.updateSettings(patch)
  const running = status === 'on'
  const usesTap = settings.clickMode !== 'poke'
  const usesPoke = settings.clickMode !== 'tap'
  const depthPercent = Math.max(-1, Math.min(1, (frame?.depth ?? 0) / (settings.pressThreshold * 1.5)))
  const flexPercent = Math.min(100, ((frame?.indexFlex ?? 0) / 140) * 100)

  return (
    <section className="panel hand-panel">
      <div className="panel-header">
        <div className="panel-title">{uiText('Hand Control — управление рукой через веб-камеру (тест)')}</div>
      </div>
      <div className="panel-body">
        <p className="hand-note">{uiText('Точка нажатия — на кончике указательного пальца: её ведёт кисть; при сгибе пальца она не сдвигается. Нажатие — быстро согнуть указательный палец и разогнуть (тап). Прокрутка — поднять указательный и средний: взмах пальцами листает на шаг (частые взмахи подряд — всё дальше); движение руки вверх-вниз листает плавно; быстрый взмах всей рукой вверх или вниз — листает с разгоном (кулак — стоп). Карта: щипок большим и указательным — зум; раскрытая ладонь с толчком к камере — перетаскивание. Кулак — отмена текущего действия. Игра на другом мониторе остаётся активным окном: системная мышь не двигается; видео с камеры никуда не отправляется и не сохраняется.')}</p>
        <div className="hand-actions">
          {running || status === 'starting'
            ? <button className="button" onClick={() => handControl.stop()}><Square size={15} />{uiText('Остановить')}</button>
            : <button className="button primary" onClick={() => void handControl.start()}><Play size={15} />{uiText('Включить камеру')}</button>}
          <button className="button ghost" disabled={!running} onClick={() => handControl.startCalibration()}><Crosshair size={15} />{uiText('Калибровка')}</button>
          <button className="button ghost" onClick={() => update({ calibration: { ...DEFAULT_SETTINGS.calibration }, homography: null })}>{uiText('Сбросить калибровку')}</button>
        </div>
        {status === 'error' && snapshot.error ? <p className="hand-error">{uiText(ERRORS[snapshot.error])}{snapshot.errorDetail ? <small className="hand-note mono"> {snapshot.errorDetail}</small> : null}</p> : null}

        <div className="hand-panel-grid">
          <div>
            <Setting icon={<Camera size={16} />} title="Камера" hint="Лучше всего камера на втором мониторе с видом на руку.">
              <select className="hand-select" value={settings.cameraId} onChange={(event) => update({ cameraId: event.target.value })}>
                <option value="">{uiText('По умолчанию')}</option>
                {cameras.map((camera, index) => <option key={camera.deviceId || index} value={camera.deviceId}>{camera.label || `${uiText('Камера')} ${index + 1}`}</option>)}
              </select>
            </Setting>
            <Setting icon={<Hand size={16} />} title="Вид руки" hint="3D-кисть и контур повторяют все пальцы — указатель это кончик пальца; «Курсор» — только точка.">
              <div className="hand-segmented">
                {(['hand3d', 'ghost', 'finger'] as const).map((cursor) => (
                  <button key={cursor} className={settings.cursor === cursor ? 'is-active' : ''} onClick={() => update({ cursor })}>{uiText({ hand3d: '3D-кисть', ghost: 'Контур', finger: 'Курсор' }[cursor])}</button>
                ))}
              </div>
            </Setting>
            <Setting title="Вычисления" hint="Видеокарта быстрее; процессор оставляет видеокарту игре.">
              <div className="hand-segmented">
                {(['auto', 'GPU', 'CPU'] as const).map((compute) => (
                  <button key={compute} className={settings.compute === compute ? 'is-active' : ''} onClick={() => update({ compute })}>{uiText({ auto: 'Автовыбор', GPU: 'Видеокарта', CPU: 'Процессор' }[compute])}</button>
                ))}
              </div>
            </Setting>
            <ToggleRow title="Зеркальное отображение" hint="Для камеры напротив вас: движение вправо — курсор вправо." on={settings.mirror} onChange={(mirror) => update({ mirror })} />
            <ToggleRow title="Естественная прокрутка" hint="Как на телефоне: рука вверх — список едет вверх." on={settings.naturalScroll} onChange={(naturalScroll) => update({ naturalScroll })} />
            <Setting title="Нажатие" hint="Тап — сгиб указательного пальца. Тычок — толчок всей рукой к экрану.">
              <div className="hand-segmented">
                {(['tap', 'poke', 'both'] as const).map((clickMode) => (
                  <button key={clickMode} className={settings.clickMode === clickMode ? 'is-active' : ''} onClick={() => update({ clickMode })}>{uiText({ tap: 'Тап', poke: 'Тычок', both: 'Оба' }[clickMode])}</button>
                ))}
              </div>
            </Setting>
            {usesTap ? <Slider title="Чувствительность тапа" hint="Насколько сильно нужно согнуть палец." min={30} max={70} step={1} value={100 - settings.tapAngle} onChange={(value) => update({ tapAngle: 100 - value })} /> : null}
            {usesPoke ? <Slider title="Чувствительность тычка" hint="Насколько сильно нужно ткнуть рукой к экрану." min={0.03} max={0.14} step={0.005} value={0.17 - settings.pressThreshold} onChange={(value) => update({ pressThreshold: Number((0.17 - value).toFixed(3)) })} /> : null}
            <Setting title="Взмах двумя пальцами" hint="Куда листает быстрый сгиб указательного и среднего пальцев.">
              <div className="hand-segmented">
                {(['down', 'up'] as const).map((flickDirection) => (
                  <button key={flickDirection} className={settings.flickDirection === flickDirection ? 'is-active' : ''} onClick={() => update({ flickDirection })}>{uiText(flickDirection === 'down' ? 'Вниз' : 'Вверх')}</button>
                ))}
              </div>
            </Setting>
            <Slider title="Шаг взмаха" hint="Сколько экрана пролистывает один взмах." min={0.15} max={0.9} step={0.05} value={settings.flickStep} onChange={(flickStep) => update({ flickStep })} />
            <ToggleRow title="Зум карты щипком" hint="Быстро отвести большой палец от указательного — приблизить; быстро свести — отдалить. Медленное движение не считается." on={settings.pinchZoom} onChange={(pinchZoom) => update({ pinchZoom })} />
            <ToggleRow title="Перетаскивание карты ладонью" hint="Раскрытая ладонь и быстрый толчок к камере — карта «зажата»; ведите рукой. Отвести руку назад или сжать кулак — отпустить." on={settings.palmGrab} onChange={(palmGrab) => update({ palmGrab })} />
            {settings.palmGrab ? <Slider title="Чувствительность толчка ладонью" hint="Насколько резко нужно толкнуть ладонь к камере." min={0.03} max={0.14} step={0.005} value={0.17 - settings.grabThreshold} onChange={(value) => update({ grabThreshold: Number((0.17 - value).toFixed(3)) })} /> : null}
            <Slider title="Плавность курсора" hint="Меньше дрожания или меньше задержки." min={0.3} max={3} step={0.1} value={3.3 - settings.smoothing} onChange={(value) => update({ smoothing: Number((3.3 - value).toFixed(2)) })} />
            <Slider title="Скорость прокрутки" min={0.8} max={5} step={0.1} value={settings.scrollSpeed} onChange={(scrollSpeed) => update({ scrollSpeed })} />
            <ToggleRow title="Показывать камеру здесь" hint="Превью видно только на этой странице." on={settings.showPreview} onChange={(showPreview) => update({ showPreview })} />
          </div>

          <div className="exp-status">
            {settings.showPreview ? <Preview mirrored={settings.mirror} running={running} /> : null}
            <Row label="Трекинг" value={running ? `${frame?.tracking === 'good' ? 'хороший' : frame?.tracking === 'weak' ? 'слабый' : 'руки нет'} · ${Math.round((frame?.confidence ?? 0) * 100)}%` : 'выключен'} ok={frame?.tracking === 'good'} />
            <Row label="Действие" value={running ? PHASE[frame?.phase ?? 'idle'] : '—'} ok={running && frame?.phase !== 'idle'} />
            <Row label="Камера / модель" value={stats ? `${stats.width}×${stats.height} · ${stats.fps} fps · ${stats.inferenceMs.toFixed(1)} мс · ${stats.delegate} · ${stats.thread === 'worker' ? 'отдельный поток' : 'основной поток'}` : '—'} ok={Boolean(stats && stats.fps >= 20)} />
            <Row label="Щипок (большой ↔ указательный)" value={running ? (frame?.pinch ?? 0).toFixed(2) : '—'} />
            {usesTap ? (
              <>
                <div className="exp-row"><span>{uiText('Сгиб указательного')}</span><strong className="mono">{Math.round(frame?.indexFlex ?? 0)}°</strong></div>
                <div className="hand-meter" aria-hidden="true"><i style={{ left: 0, width: `${flexPercent}%` }} /></div>
              </>
            ) : null}
            {usesPoke ? (
              <>
                <div className="exp-row"><span>{uiText('Глубина тычка')}</span><strong className="mono">{(frame?.depth ?? 0).toFixed(3)} / {settings.pressThreshold.toFixed(3)}</strong></div>
                <div className="hand-meter" aria-hidden="true">
                  <i style={depthPercent >= 0 ? { left: '50%', width: `${depthPercent * 50}%` } : { left: `${50 + depthPercent * 50}%`, width: `${-depthPercent * 50}%` }} />
                  <b style={{ left: `${50 + 50 / 1.5}%` }} />
                </div>
              </>
            ) : null}
            <div className="hand-pose">
              {(['index', 'middle', 'ring', 'pinky'] as const).map((finger) => (
                <span key={finger} className={snapshot.pose[finger] ? 'is-on' : ''}>{uiText({ index: 'указательный', middle: 'средний', ring: 'безымянный', pinky: 'мизинец' }[finger])}</span>
              ))}
            </div>
            <Row label="Нажатия / отмены / прокрутки" value={`${snapshot.counters.clicks} / ${snapshot.counters.cancels} / ${snapshot.counters.scrolls}`} />
            <Row label="Зум / захваты карты" value={`${snapshot.counters.zooms} / ${snapshot.counters.grabs}`} />
            <Row label="Последнее нажатие" value={snapshot.lastTarget || '—'} />
            {desktop ? <Row label="Активное окно Windows" value={foreground || '—'} ok={running && Boolean(foreground) && !/tarkov operations|raid os/i.test(foreground)} /> : null}
            {desktop ? <p className="hand-note">{uiText('Во время теста здесь должно быть окно игры — не Raid OS.')}</p> : null}
          </div>
        </div>

        <TestZone />
      </div>
    </section>
  )
}

function TestZone() {
  const [counts, setCounts] = useState([0, 0, 0])
  const [picked, setPicked] = useState(-1)
  return (
    <>
      <div className="exp-row"><span><MoveVertical size={14} /> {uiText('Тестовая зона: нажимайте кнопки и листайте список')}</span></div>
      <div className="hand-test-zone">
        {counts.map((count, index) => (
          <button key={index} className="button" onClick={() => setCounts((current) => current.map((value, i) => (i === index ? value + 1 : value)))}>
            {uiText('Кнопка')} {index + 1} · {count}
          </button>
        ))}
      </div>
      <div className="hand-test-list">
        {Array.from({ length: 40 }, (_, index) => (
          <button key={index} className={picked === index ? 'is-picked' : ''} onClick={() => setPicked(index)}>
            <span>{uiText('Строка')} {index + 1}</span><span>{picked === index ? '✓' : ''}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function Preview({ mirrored, running }: { mirrored: boolean; running: boolean }) {
  const holder = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const snapshot = useHandControl()

  useEffect(() => {
    const source = handControl.video
    const box = holder.current
    if (!running || !source?.srcObject || !box) return
    // A second <video> on the same local stream; frames stay on this computer.
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = source.srcObject
    box.prepend(video)
    void video.play().catch(() => {})
    return () => { video.srcObject = null; video.remove() }
  }, [running])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const width = (canvas.width = 320)
    const height = (canvas.height = 240)
    context.clearRect(0, 0, width, height)
    const raw = snapshot.raw
    if (!raw) return
    context.strokeStyle = 'rgba(223, 189, 112, .9)'
    context.lineWidth = 2
    for (const [a, b] of HAND_BONES) {
      context.beginPath()
      context.moveTo(raw.image[a].x * width, raw.image[a].y * height)
      context.lineTo(raw.image[b].x * width, raw.image[b].y * height)
      context.stroke()
    }
  }, [snapshot.raw])

  return (
    <div ref={holder} className={`hand-preview${mirrored ? ' is-mirrored' : ''}`}>
      <canvas ref={canvasRef} />
      {!running ? <div className="hand-preview-empty">{uiText('Камера выключена')}</div> : null}
    </div>
  )
}

function Setting({ icon, title, hint, children }: { icon?: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row exp-toggle">
      <span><strong>{icon}{uiText(title)}</strong>{hint ? <small>{uiText(hint)}</small> : null}</span>
      {children}
    </div>
  )
}

function ToggleRow({ title, hint, on, onChange }: { title: string; hint?: string; on: boolean; onChange: (value: boolean) => void }) {
  return (
    <Setting title={title} hint={hint}>
      <button className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={uiText(title)} onClick={() => onChange(!on)}><span /></button>
    </Setting>
  )
}

function Slider({ title, hint, min, max, step, value, onChange }: { title: string; hint?: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <Setting title={title} hint={hint}>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={uiText(title)} onChange={(event) => onChange(Number(event.target.value))} />
    </Setting>
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
