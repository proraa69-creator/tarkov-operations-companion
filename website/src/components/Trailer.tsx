import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../hooks/motion'

/**
 * Product trailer — the centrepiece of the home page.
 *
 * Source: `website/public/media/trailer.mp4` (H.264, 720p, small: it ships inside the server exe, so every MB slows the server's start).
 * Poster: `trailer-poster.jpg` when present, otherwise the placeholder `trailer-poster.svg`.
 * When a file exists it autoplays muted and loops (unless the visitor prefers reduced motion); the custom
 * controls toggle play/pause and sound. When no source can be played the poster stays with a "coming soon" note.
 */
const TRAILER_SOURCES = [
  { src: '/media/trailer.mp4', type: 'video/mp4' },
]
const POSTER_JPG = '/media/trailer-poster.jpg'
const POSTER_FALLBACK = '/media/trailer-poster.svg'

type Status = 'loading' | 'ready' | 'missing'

export function Trailer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [poster, setPoster] = useState(POSTER_FALLBACK)
  const [reducedMotion] = useState(prefersReducedMotion)

  // Use the real JPG poster automatically once it exists.
  useEffect(() => {
    const image = new Image()
    let alive = true
    image.onload = () => { if (alive && image.naturalWidth > 0) setPoster(POSTER_JPG) }
    image.src = POSTER_JPG
    return () => { alive = false }
  }, [])

  // Muted autoplay. React does not reliably reflect the `muted` attribute, so set the property directly.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    if (!reducedMotion) video.play().catch(() => { /* blocked or no source — the overlay handles it */ })
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
        poster={poster}
        loop
        muted
        playsInline
        preload={reducedMotion ? 'metadata' : 'auto'}
        aria-label="Трейлер Raid OS"
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
        Ваш браузер не поддерживает встроенное видео.
      </video>

      <div className="trailer-vignette" aria-hidden="true" />

      {missing ? (
        <div className="trailer-overlay">
          <span className="trailer-note">Трейлер готовится к публикации — скоро он появится здесь.</span>
        </div>
      ) : (
        <>
          {!playing && (status === 'ready' || reducedMotion) && (
            <button type="button" className="trailer-overlay" onClick={togglePlay} aria-label="Смотреть трейлер">
              <span className="play-button" aria-hidden="true"><Play fill="currentColor" /></span>
              <span className="trailer-caption">Смотреть трейлер</span>
            </button>
          )}
          <div className="trailer-controls">
            <button type="button" className="ctrl-button" onClick={togglePlay} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <button type="button" className="ctrl-button" onClick={toggleMute} aria-label={muted ? 'Включить звук' : 'Выключить звук'} aria-pressed={!muted}>
              {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
              <span className="ctrl-label">{muted ? 'Включить звук' : 'Выключить звук'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
