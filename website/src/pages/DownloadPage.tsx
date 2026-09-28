import { Cpu, Download, HardDrive, Monitor, MonitorCog, Wifi } from 'lucide-react'
import { Notice } from '../components/Notice'
import { APP_VERSION, DOWNLOAD_AVAILABLE, DOWNLOAD_URL } from '../config'

const REQUIREMENTS = [
  { icon: Monitor, name: 'Система', value: 'Windows 10 или Windows 11, 64-bit' },
  { icon: Cpu, name: 'ОЗУ', value: 'как для самой игры: от 8 ГБ ОЗУ, рекомендуется 16 ГБ и больше' },
  { icon: HardDrive, name: 'Диск', value: 'около 500 МБ свободного места' },
  { icon: Wifi, name: 'Интернет', value: 'нужен для входа в аккаунт и обновления данных' },
  { icon: MonitorCog, name: 'Экран', value: 'от 1280×720; для оверлея — режим «Оконный без рамки»' },
]

export function DownloadButton({ large = true }: { large?: boolean }) {
  return (
    <a
      className={`button primary${large ? ' large' : ''}`}
      href={DOWNLOAD_URL}
      aria-disabled={!DOWNLOAD_AVAILABLE}
      onClick={(event) => { if (!DOWNLOAD_AVAILABLE) event.preventDefault() }}
      rel="noopener"
    >
      <Download aria-hidden="true" />
      Скачать для Windows
    </a>
  )
}

export function DownloadPage() {
  return (
    <div className="page page-in">
      <div className="container">
        <div className="page-header">
          <div>
            <div className="eyebrow">Загрузка</div>
            <h1 className="page-title">Скачать приложение</h1>
            <p className="page-subtitle">Портативная версия для Windows: скачайте файл и запустите — установка не требуется.</p>
          </div>
        </div>

        <div className="download-hero">
          <div className="panel download-card">
            <div className="download-meta">
              <span className="tag brass">Версия {APP_VERSION}</span>
              <span className="tag">Windows · portable .exe</span>
              <span className="tag green">Бета</span>
            </div>
            <div>
              <h2 style={{ margin: '0 0 6px', fontSize: 24, letterSpacing: '-.03em' }}>Tarkov Operations Companion</h2>
              <p className="muted" style={{ margin: 0 }}>Карты и мини-карта поверх игры, задания и Капа, барахолка и профили PvP / PvE / Сезон.</p>
            </div>
            <div><DownloadButton /></div>
            {!DOWNLOAD_AVAILABLE && (
              <Notice tone="info" title="Ссылка скоро появится">Файл сборки ещё не опубликован. Как только релиз выйдет, кнопка начнёт скачивание.</Notice>
            )}
            <Notice tone="warn" title="Оверлей и мини-карта поверх игры">
              В настройках Escape from Tarkov выберите режим экрана <b>«Оконный без рамки»</b> (Borderless). В полноэкранном режиме Windows не даёт показывать окна поверх игры.
            </Notice>
          </div>

          <div className="panel">
            <div className="panel-header"><div className="panel-title">Системные требования</div></div>
            <div className="panel-body">
              <ul className="req-list">
                {REQUIREMENTS.map(({ icon: Icon, name, value }) => (
                  <li key={name}><Icon aria-hidden="true" /><span className="req-name">{name}</span><span>{value}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-header"><div className="panel-title">Как установить</div></div>
          <div className="panel-body">
            <ol className="ordered">
              <li><strong>Скачайте файл</strong> кнопкой выше и сохраните его в удобную папку.</li>
              <li><strong>Запустите .exe.</strong> Если Windows SmartScreen покажет предупреждение, нажмите «Подробнее» → «Выполнить в любом случае».</li>
              <li><strong>Войдите в аккаунт</strong> — тот же e-mail и пароль, что и на сайте.</li>
              <li><strong>Переключите игру в режим «Оконный без рамки»</strong>, чтобы мини-карта и подсказки показывались поверх игры.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
