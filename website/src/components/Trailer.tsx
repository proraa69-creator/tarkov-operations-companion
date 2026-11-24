import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../hooks/motion'
import { tr, useSiteLocale, type SiteLocale } from '../i18n'

/**
 * Product trailer — the centrepiece of the home page.
 *
 * Source: `website/public/media/trailer.mp4`, and `trailer-en.mp4` when the site is in English (owner, 27.10.2026: the
 * English site shows the English trailer, chosen by hand or automatically). H.264, 720p, small: they ship inside the
 * server exe, so every MB slows the server's start.
 * It autoplays muted and loops; the custom controls toggle play/pause and sound. No picture is shown before the video
 * (owner, 11.10.2026: a card flashed on every load before the video, «нужно убрать ее вообще»): the frame stays dark
 * until the first frame is decoded. Only when the video does not autoplay (the visitor prefers reduced motion, or the
 * browser refused) the title card `trailer-poster.jpg` waits with the play button. When no source can be played a
 * "coming soon" note is shown.
 */
const TRAILER_SOURCES: Record<SiteLocale, Array<{ src: string; type: string }>> = {
  ru: [{ src: '/media/trailer.mp4', type: 'video/mp4' }],
  en: [{ src: '/media/trailer-en.mp4', type: 'video/mp4' }],
}
const POSTER: Record<SiteLocale, string> = { ru: '/media/trailer-poster.jpg', en: '/media/trailer-poster-en.jpg' }

type Status = 'loading' | 'ready' | 'missing'

export function Trailer() {
  const locale = useSiteLocale()
  // A new player for the other language: the <video> loads the other file from the start.
  return <TrailerPlayer key={locale} locale={locale} />
}

function TrailerPlayer({ locale }: { locale: SiteLocale }) {
  const sources = TRAILER_SOURCES[locale]
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [reducedMotion] = useState(prefersReducedMotion)
  // The browser refused to autoplay (iOS low-power mode, data saver): the title card and the play button wait for a tap.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const stillFrame = reducedMotion || autoplayBlocked

  // Muted autoplay. React does not reliably reflect the `muted` attribute, so set the property directly.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    if (!reducedMotion) {
      video.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') setAutoplayBlocked(true)
        // No source: the <source> error sets 'missing'.
      })
    }
  }, [reducedMotion])

  function togglePlay() {
    const video = videoRef.current
    if (!video || status === 'missing') return
    if (video.paused) video.play().catch(() => { /* ignore */ })
    else video.pause()
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    if (!video.muted && video.paused) video.play().catch(() => { /* ignore */ })
  }

  const missing = status === 'missing'

  return (
    <div className={`trailer${playing ? ' is-playing' : ''}${missing ? ' is-missing' : ''}`}>
      <video
        ref={videoRef}
        poster={stillFrame ? POSTER[locale] : undefined}
        loop
        muted
        playsInline
        preload={reducedMotion ? 'metadata' : 'auto'}
        aria-label={tr('Трейлер Raid OS')}
        onLoadedData={() => setStatus('ready')}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onClick={togglePlay}
      >
        {sources.map((source, index) => (
          <source
            key={source.src}
            src={source.src}
            type={source.type}
            // The error on the LAST <source> means no source could be played.
            onError={index === sources.length - 1 ? () => setStatus('missing') : undefined}
          />
        ))}
        {tr('Ваш браузер не поддерживает встроенное видео.')}
      </video>

      <div className="trailer-vignette" aria-hidden="true" />

      {missing ? (
        <div className="trailer-overlay">
          <span className="trailer-note">{tr('Трейлер готовится к публикации — скоро он появится здесь.')}</span>
        </div>
      ) : (
        <>
          {!playing && (status === 'ready' || stillFrame) && (
            <button type="button" className="trailer-overlay" onClick={togglePlay} aria-label={tr('Смотреть трейлер')}>
              <span className="play-button" aria-hidden="true"><Play fill="currentColor" /></span>
              <span className="trailer-caption">{tr('Смотреть трейлер')}</span>
            </button>
          )}
          <div className="trailer-controls">
            <button type="button" className="ctrl-button" onClick={togglePlay} aria-label={tr(playing ? 'Пауза' : 'Воспроизвести')}>
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <button type="button" className="ctrl-button" onClick={toggleMute} aria-label={tr(muted ? 'Включить звук' : 'Выключить звук')} aria-pressed={!muted}>
              {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
              <span className="ctrl-label">{tr(muted ? 'Включить звук' : 'Выключить звук')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
