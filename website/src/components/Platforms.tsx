/**
 * Platform line under the download buttons: Windows is available now, the phone apps (iOS / Android, the
 * Capacitor build in android/ and ios/) are not published yet, so they are marked «скоро».
 */
function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.1 10.4 4v7.2H3V5.1Zm8.4-1.2L21 2.5v8.7h-9.6V3.9ZM3 12.8h7.4V20L3 18.9v-6.1Zm8.4 0H21v8.7l-9.6-1.4v-7.3Z" /></svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.7 1.3-2.7s-2.5-1-2.5-4Zm-2.4-7.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4Z" /></svg>
  )
}

function AndroidIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.6 9.5 19.4 6.4a.4.4 0 0 0-.7-.4l-1.8 3.1A11 11 0 0 0 12 8a11 11 0 0 0-4.9 1.1L5.3 6a.4.4 0 1 0-.7.4l1.8 3.1A9.4 9.4 0 0 0 1.5 17h21a9.4 9.4 0 0 0-4.9-7.5ZM7 14.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" /></svg>
  )
}

export function Platforms({ align = 'center' }: { align?: 'center' | 'start' }) {
  return (
    <ul className={`platforms ${align === 'start' ? 'is-start' : ''}`} aria-label="Платформы">
      <li className="is-ready"><WindowsIcon /><span>Windows</span><em>доступно</em></li>
      <li><AppleIcon /><span>iOS</span><em>скоро</em></li>
      <li><AndroidIcon /><span>Android</span><em>скоро</em></li>
    </ul>
  )
}
