import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

export function CopyButton({ value, label = 'Копировать' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [state])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <button type="button" className="button small" onClick={copy} aria-live="polite">
      {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {state === 'copied' ? 'Скопировано' : state === 'failed' ? 'Выделите вручную' : label}
    </button>
  )
}
