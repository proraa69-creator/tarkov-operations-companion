import { useState } from 'react'
import { uiText } from '../i18n/renderText'
import { X } from 'lucide-react'
import type { KappaItemRequirement } from '../shared/kappaItems'

interface KappaItemsModalProps {
  items: Map<string, KappaItemRequirement>
  onClose: () => void
}

export function KappaItemsModal({ items, onClose }: KappaItemsModalProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = Array.from(items.values()).filter((item) =>
    item.itemName.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--panel)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--line)',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow)',
        }}
      >
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, color: 'var(--text)' }}>
            {uiText('Предметы для Каппы')}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px', borderBottom: '1px solid var(--line)' }}>
          <input
            type="text"
            placeholder={uiText('Поиск предметов...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
            }}
          />
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {filtered.length === 0 && (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              {uiText('Предметы не найдены')}
            </div>
          )}
          {filtered.map((item) => (
            <div
              key={item.itemId}
              style={{
                padding: '10px 12px',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'start',
                  marginBottom: '4px',
                }}
              >
                <strong style={{ color: 'var(--text)', fontSize: '13px' }}>
                  {uiText(item.itemName)}
                </strong>
                <span
                  style={{
                    background: 'var(--brass)',
                    color: 'var(--bg)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                  }}
                >
                  {uiText(String(item.count))}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {uiText('Нужен для:')}
                <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {item.quests.slice(0, 3).map((questName) => (
                    <span
                      key={questName}
                      style={{
                        background: 'var(--green-soft)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    >
                      {uiText(questName)}
                    </span>
                  ))}
                  {item.quests.length > 3 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {uiText(`+${item.quests.length - 3}`)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: '12px',
            borderTop: '1px solid var(--line)',
            textAlign: 'right',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: 'var(--brass)',
              color: 'var(--bg)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            {uiText('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
