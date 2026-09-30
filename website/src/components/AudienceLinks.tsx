import { Download, Link2, QrCode, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, type CampaignStats } from '../api'
import { useAuth } from '../auth'
import { CopyButton } from './CopyButton'
import { encodeQr, qrPath } from './qrCode'
import '../extras.css'

const PRESETS = ['youtube', 'twitch', 'vk', 'telegram', 'shorts']
const CAMPAIGN = /^[a-z0-9_-]{1,32}$/
const numberFormat = new Intl.NumberFormat('ru-RU')

/** `/r/CODE` or `/r/CODE?c=label` on this site. */
export function audienceLink(code: string, campaign = '') {
  const base = `${window.location.origin}/r/${encodeURIComponent(code)}`
  return campaign ? `${base}?c=${encodeURIComponent(campaign)}` : base
}

export function QrImage({ value, size = 184, label }: { value: string; size?: number; label: string }) {
  const matrix = useMemo(() => encodeQr(value, 'M'), [value])
  const box = matrix.size + 8
  return (
    <svg className="qr-image" width={size} height={size} viewBox={`0 0 ${box} ${box}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={box} height={box} fill="#fff" />
      <path d={qrPath(matrix, 4)} fill="#0a0f0c" />
    </svg>
  )
}

/** A 1024 px PNG of the QR code (white background, quiet zone) for the stream overlay. */
function downloadQrPng(value: string, fileName: string) {
  const matrix = encodeQr(value, 'M')
  const box = matrix.size + 8
  const scale = Math.max(8, Math.floor(1024 / box))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = box * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  matrix.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale) }))
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = fileName
  link.click()
}

/**
 * «Сгенерировать ссылку для аудитории»: the streamer's link with an optional campaign label (/r/CODE?c=youtube), a QR code
 * for the stream overlay and copy buttons. Viewers who open it get the code applied automatically at registration.
 */
export function AudienceLinks({ code }: { code: string }) {
  const auth = useAuth()
  const [label, setLabel] = useState('')
  const [generated, setGenerated] = useState<{ link: string; campaign: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignStats[] | null>(null)

  useEffect(() => {
    if (!auth.token) return
    let cancelled = false
    api.referralCampaigns(auth.token).then((next) => { if (!cancelled) setCampaigns(next.campaigns) }, () => undefined)
    return () => { cancelled = true }
  }, [auth.token])

  function generate(event?: FormEvent, preset?: string) {
    event?.preventDefault()
    const campaign = (preset ?? label).trim().toLowerCase()
    if (campaign && !CAMPAIGN.test(campaign)) { setError('Метка: латиница, цифры, «_» или «-», до 32 символов. Например: youtube, twitch_overlay.'); return }
    if (preset !== undefined) setLabel(preset)
    setError(null)
    setGenerated({ link: audienceLink(code, campaign), campaign })
  }

  return (
    <div className="audience">
      <div className="audience-head">
        <div className="field-label"><Link2 size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />Ссылки для аудитории</div>
        <span className="dim" style={{ fontSize: 12 }}>Зрителям не нужно вводить промокод — код применится сам при регистрации.</span>
      </div>
      <form className="audience-form" onSubmit={generate}>
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          <span className="field-hint">Метка кампании (необязательно) — чтобы видеть, откуда пришли зрители</span>
          <input className="input" value={label} maxLength={32} spellCheck={false} autoComplete="off" placeholder="например, youtube" onChange={(e) => setLabel(e.target.value)} aria-label="Метка кампании" />
        </label>
        <button type="submit" className="button primary"><Sparkles aria-hidden="true" />Сгенерировать ссылку для аудитории</button>
      </form>
      <div className="chip-row" aria-label="Готовые метки">
        {PRESETS.map((preset) => <button key={preset} type="button" className={`chip${generated?.campaign === preset ? ' is-on' : ''}`} onClick={() => generate(undefined, preset)}>{preset}</button>)}
      </div>
      {error && <div className="field-hint" style={{ color: 'var(--danger)' }} role="alert">{error}</div>}
      {generated && (
        <div className="audience-result">
          <QrImage value={generated.link} label={`QR-код ссылки ${generated.link}`} />
          <div className="audience-result-text">
            <span className="field-label">{generated.campaign ? <>Ссылка с меткой <span className="mono" style={{ color: 'var(--brass-strong)' }}>{generated.campaign}</span></> : 'Ссылка без метки'}</span>
            <div className="copy-row"><code title={generated.link}>{generated.link}</code><CopyButton value={generated.link} /></div>
            <div className="audience-actions">
              <button type="button" className="button small" onClick={() => downloadQrPng(generated.link, `qr-${code}${generated.campaign ? `-${generated.campaign}` : ''}.png`)}><Download aria-hidden="true" />Скачать QR (PNG)</button>
            </div>
            <span className="field-hint"><QrCode size={12} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />QR-код можно поставить на оверлей стрима: зритель наведёт камеру телефона и откроет ссылку.</span>
          </div>
        </div>
      )}
      {campaigns && campaigns.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table">
            <thead><tr><th scope="col">Метка</th><th scope="col" className="num">Переходы за 30 дней</th><th scope="col" className="num">Всего</th></tr></thead>
            <tbody>{campaigns.map((item) => (
              <tr key={item.campaign}><td className="mono">{item.campaign}</td><td className="num mono">{numberFormat.format(item.visits30d)}</td><td className="num mono">{numberFormat.format(item.visits)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
