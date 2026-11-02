import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { tr } from '../i18n'

/**
 * Browsers built into apps (the «Яндекс» app, ../inAppBrowser.ts) may refuse the async clipboard: the older copy of a
 * selected text still works there on the same click.
 */
function copyBySelection(value: string) {
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

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
      setState(copyBySelection(value) ? 'copied' : 'failed')
    }
  }

  return (
    <button type="button" className="button small" onClick={copy} aria-live="polite">
      {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {tr(state === 'copied' ? 'Скопировано' : state === 'failed' ? 'Выделите вручную' : label)}
    </button>
  )
}
