import { useState } from 'react'
import { uiText } from '../i18n/renderText'
import { getStoredKeybinds, setStoredKeybinds, normalizeKeybind, type KeybindConfig } from '../data/keybindsConfig'
import { RotateCcw } from 'lucide-react'

const KEYBIND_LABELS: Record<keyof KeybindConfig, { ru: string; en: string }> = {
  search: { ru: 'Глобальный поиск', en: 'Global Search' },
  minimap: { ru: 'Мини карта', en: 'Mini Map' },
  itemInfo: { ru: 'Информация о предмете', en: 'Item Info' },
}

export function KeybindsPage() {
  const [keybinds, setKeybinds] = useState(() => getStoredKeybinds())
  const [editing, setEditing] = useState<keyof KeybindConfig | null>(null)
  const [pendingKey, setPendingKey] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent, field: keyof KeybindConfig) => {
    e.preventDefault()
    const parts: string[] = []
    if (e.ctrlKey) parts.push('ctrl')
    if (e.metaKey) parts.push('meta')
    if (e.altKey) parts.push('alt')
    if (e.shiftKey) parts.push('shift')

    const key = e.key.toLowerCase()
    if (!['control', 'meta', 'alt', 'shift'].includes(key)) {
      parts.push(key)
    }

    if (parts.length > 0) {
      const newKeybind = normalizeKeybind(parts.join('+'))
      setKeybinds((prev) => ({ ...prev, [field]: newKeybind }))
      setStoredKeybinds({ [field]: newKeybind })
      setEditing(null)
      setPendingKey('')
    }
  }

  const resetKeybinds = () => {
    const defaults = {
      search: 'ctrl+k',
      minimap: 'm',
      itemInfo: 'z',
    }
    setKeybinds(defaults)
    setStoredKeybinds(defaults)
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{uiText('Горячие клавиши')}</h1>
        <p>{uiText('Настройте комбинации клавиш для быстрого доступа к функциям')}</p>
      </div>

      <div className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2>{uiText('Управление')}</h2>
          <button
            onClick={resetKeybinds}
            style={{
              padding: '8px 12px',
              background: 'var(--danger)',
              color: 'var(--text)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
            }}
          >
            <RotateCcw size={14} />
            {uiText('По умолчанию')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {(Object.keys(keybinds) as Array<keyof KeybindConfig>).map((field) => (
            <div
              key={field}
              style={{
                padding: '12px',
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ color: 'var(--text)', fontWeight: 500, fontSize: '14px' }}>
                  {uiText(KEYBIND_LABELS[field].ru)}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
                  {field === 'search' && uiText('Ctrl+K или Custom')}
                  {field === 'minimap' && uiText('По умолчанию: M')}
                  {field === 'itemInfo' && uiText('По умолчанию: Z')}
                </div>
              </div>
              <button
                onClick={() => setEditing(field)}
                style={{
                  padding: '8px 12px',
                  background: editing === field ? 'var(--brass)' : 'var(--panel-2)',
                  color: 'var(--text)',
                  border: editing === field ? '2px solid var(--brass-strong)' : '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '13px',
                  minWidth: '120px',
                  textAlign: 'center',
                }}
                onKeyDown={(e) => editing === field && handleKeyDown(e, field)}
                onBlur={() => setEditing(null)}
                autoFocus={editing === field}
              >
                {editing === field ? uiText('Нажмите клавишу...') : keybinds[field].toUpperCase()}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
