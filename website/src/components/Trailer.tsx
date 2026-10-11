import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../hooks/motion'
import { tr } from '../i18n'

/**
 * Product trailer — the centrepiece of the home page.
 *
 * Source: `website/public/media/trailer.mp4` (H.264, 720p, small: it ships inside the server exe, so every MB slows the server's start).
 * It autoplays muted and loops; the custom controls toggle play/pause and sound. No picture is shown before the video
 * (owner, 11.10.2026: a card flashed on every load before the video, «нужно убрать ее вообще»): the frame stays dark
 * until the first frame is decoded. Only when the video does not autoplay (the visitor prefers reduced motion, or the
 * browser refused) the title card `trailer-poster.jpg` waits with the play button. When no source can be played a
 * "coming soon" note is shown.
 */
const TRAILER_SOURCES = [
  { src: '/media/trailer.mp4', type: 'video/mp4' },
]
const POSTER = '/media/trailer-poster.jpg'

type Status = 'loading' | 'ready' | 'missing'

export function Trailer() {
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
        poster={stillFrame ? POSTER : undefined}
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
        {TRAILER_SOURCES.map((source, index) => (
          <source
            key={source.src}
            src={source.src}
            type={source.type}
            // The error on the LAST <source> means no source could be played.
            onError={index === TRAILER_SOURCES.length - 1 ? () => setStatus('missing') : undefined}
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
