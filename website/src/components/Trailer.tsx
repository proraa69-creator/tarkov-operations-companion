import { Play } from 'lucide-react'
import { useRef, useState } from 'react'

/**
 * Product trailer.
 *
 * TODO(trailer): the real trailer file is NOT in the repository yet. Put the encoded video at
 * `website/public/media/trailer.mp4` (H.264/AAC, 1920x1080, ideally < 30 MB) — or point `TRAILER_SRC`
 * at a CDN URL. Until then the poster (`/media/trailer-poster.svg`) is shown and pressing "play" shows a
 * friendly "trailer coming soon" note instead of a broken player.
 */
const TRAILER_SRC = '/media/trailer.mp4'
const TRAILER_POSTER = '/media/trailer-poster.svg'

export function Trailer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'poster' | 'playing' | 'missing'>('poster')

  function play() {
    const video = videoRef.current
    if (!video) return
    video.controls = true
    setState('playing')
    video.play().catch(() => {
      // Autoplay policies reject play() without a gesture; a missing file triggers the error event below.
      if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) setState('missing')
    })
  }

  function missing() {
    const video = videoRef.current
    if (video) video.controls = false
    setState('missing')
  }

  return (
    <div className="trailer">
      <video ref={videoRef} poster={TRAILER_POSTER} preload="none" playsInline onError={missing} aria-label="Трейлер Tarkov Operations Companion">
        <source src={TRAILER_SRC} type="video/mp4" onError={missing} />
        Ваш браузер не поддерживает встроенное видео.
      </video>
      {state !== 'playing' && (
        <button type="button" className="trailer-overlay" onClick={play} disabled={state === 'missing'} aria-label="Смотреть трейлер">
          {state === 'missing' ? (
            <span className="trailer-note">Трейлер готовится к публикации — скоро он появится здесь. А пока загляните в разделы ниже.</span>
          ) : (
            <>
              <span className="play-button" aria-hidden="true"><Play fill="currentColor" /></span>
              <span className="trailer-caption">Смотреть трейлер</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
