import { useState, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { useRaidSmokeOptions } from '../app/raidSmokeSetting'
import { smokeHex, smokeSummary } from '../app/raidSmokeReadout'
import { bossFiguresFor } from '../data/bossFigures'
import { useTarkovData } from '../data/DataProvider'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { BossFigures } from './BossFigures'
import { RaidSmoke } from './RaidSmoke'
import '../styles/raidSmokePreview.css'

const times = (value: number) => `×${value.toFixed(2)}`

/**
 * Settings → «Дым за боссами»: the real smoke (RaidSmoke) behind the bosses of the Overview map on a small dark card,
 * so the plume can be tuned without going to the Overview, and a readout of every value.
 */
export function RaidSmokePreview() {
  const { selectedMapId } = useAppState()
  const { data } = useTarkovData()
  const mapId = bossFiguresFor(selectedMapId).length ? selectedMapId : 'customs'
  const art = data.maps.find((map) => map.id === mapId)?.imageUrl
  return (
    <div className="smoke-preview" aria-label={uiText('Предпросмотр дыма')}>
      {art && <div className="smoke-preview-art" style={{ backgroundImage: `url(${art})` }} />}
      <RaidSmoke mapId={mapId} />
      <BossFigures mapId={mapId} />
      <span className="smoke-preview-badge">{uiText('Предпросмотр')}</span>
    </div>
  )
}

export function RaidSmokeReadout() {
  const options = useRaidSmokeOptions()
  const { locale } = useLocale()
  const en = locale === 'en'
  const [copied, setCopied] = useState(false)
  const base = smokeHex(options.hue, options.tone), top = smokeHex(options.topHue, options.tone)
  const rows: Array<[string, ReactNode]> = [
    ['Ширина факела', times(options.width)],
    ['Скорость анимации', times(options.speed)],
    ['Цвет факела', <><i className="smoke-readout-dot" style={{ background: base }} />{options.hue}° · {base}</>],
    ['Оттенок (темнее — светлее)', `${options.tone > 0 ? '+' : ''}${options.tone.toFixed(2)}`],
    ['Градиент', en ? (options.gradient ? 'on' : 'off') : (options.gradient ? 'вкл' : 'выкл')],
    ['Цвет верхушки', <><i className="smoke-readout-dot" style={{ background: top, opacity: options.gradient ? 1 : 0.4 }} />{options.topHue}° · {top}{options.gradient ? '' : en ? ' (gradient off)' : ' (градиент выкл.)'}</>],
  ]
  const summary = smokeSummary(options)
  const copy = () => {
    void navigator.clipboard?.writeText(summary).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {})
  }
  return (
    <div className="smoke-readout">
      <div className="smoke-readout-head">
        <strong>{uiText('Текущие параметры дыма')}</strong>
        <button type="button" className="button small ghost" onClick={copy}><Copy size={13} />{uiText(copied ? ' Скопировано' : ' Копировать')}</button>
      </div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}><dt>{uiText(label)}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <code>{summary}</code>
    </div>
  )
}
