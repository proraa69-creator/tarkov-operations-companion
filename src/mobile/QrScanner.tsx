import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, LoaderCircle } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { parseScannedQr, type AccountDeepLink } from './deepLink'

/** The browser's own QR reader (Chrome and the Android WebView have it; the iPhone's WebView does not yet). */
interface Detector { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
type DetectorClass = new (options: { formats: string[] }) => Detector
const detectorClass = () => (typeof window !== 'undefined' ? (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector : undefined)

/** Whether this phone can read a QR code with the app's own camera view. */
export const canScanInApp = () => Boolean(detectorClass() && navigator.mediaDevices?.getUserMedia)

/**
 * «Войти по QR-коду» with the app's own camera (owner, 25.11.2026: «вход QR-кодом во все стороны»): the back camera in a
 * frame; the first Raid OS sign-in QR it reads (mobile/deepLink.ts parseScannedQr) is handed on and the camera stops. A QR
 * that is not ours is ignored. Where the phone has no reader, it says how to use the phone's own camera instead.
 */
export function QrScanner({ onLink }: { onLink: (link: AccountDeepLink) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'starting' | 'running' | 'denied' | 'unsupported'>(() => (canScanInApp() ? 'starting' : 'unsupported'))
  const [foreign, setForeign] = useState(false)
  const done = useRef(onLink)
  done.current = onLink

  useEffect(() => {
    const Reader = detectorClass()
    if (!Reader || !navigator.mediaDevices?.getUserMedia) return
    let stream: MediaStream | null = null
    let timer = 0
    let active = true
    const reader = new Reader({ formats: ['qr_code'] })
    const look = async () => {
      if (!active || !video.current) return
      try {
        const [found] = await reader.detect(video.current)
        if (found) {
          const link = parseScannedQr(found.rawValue)
          if (link) { active = false; stream?.getTracks().forEach((track) => track.stop()); done.current(link); return }
          setForeign(true)
        }
      } catch { /* a frame not ready yet */ }
      timer = window.setTimeout(() => void look(), 250)
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((media) => {
      if (!active) { media.getTracks().forEach((track) => track.stop()); return }
      stream = media
      const element = video.current
      if (!element) return
      element.srcObject = media
      void element.play().catch(() => {})
      setState('running')
      timer = window.setTimeout(() => void look(), 400)
    }, () => { if (active) setState('denied') })
    return () => { active = false; window.clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()) }
  }, [])

  if (state === 'unsupported' || state === 'denied') {
    return (
      <div className="import-warning account-qr-scanner-note">
        <AlertTriangle size={17} />
        <span>{uiText(state === 'denied'
          ? 'Нет доступа к камере. Разрешите камеру для Raid OS в настройках телефона или наведите на QR-код обычную камеру телефона — Raid OS откроется сам.'
          : 'Наведите на QR-код обычную камеру телефона и нажмите на ссылку — Raid OS откроется сам.')}</span>
      </div>
    )
  }
  return (
    <div className="account-qr-scanner">
      <video ref={video} playsInline muted aria-label={uiText('Камера')} />
      <i aria-hidden="true" />
      <small>{state === 'starting' ? <><LoaderCircle className="spin" size={14} />{uiText('Включаем камеру…')}</> : <><Camera size={14} />{uiText(foreign ? 'Это не QR-код Raid OS' : 'Наведите камеру на QR-код')}</>}</small>
    </div>
  )
}
