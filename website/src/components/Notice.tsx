import { CircleCheck, Info, TriangleAlert, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

type Tone = 'info' | 'success' | 'error' | 'warn' | 'offline'

export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const Icon = tone === 'success' ? CircleCheck : tone === 'error' ? TriangleAlert : tone === 'warn' ? TriangleAlert : tone === 'offline' ? WifiOff : Info
  return (
    <div className={`notice ${tone === 'offline' ? 'warn' : tone}`} role={tone === 'error' || tone === 'offline' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  )
}
