import { createContext, useContext, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { findQuestText, useQuestTextOverrides, useQuestTextWriter, type QuestTextField } from '../data/questTextOverrides'
import { QuestTextRow } from './QuestTextEditor'
import './questEditor.css'

/**
 * In-place editing of the quest window at the bottom of the map (owner app, quest constructor on; owner, 16.10.2026:
 * «в открывшемся окне квеста на карте … кнопка карандаша, справа от каждой надписи, что бы можно было изменить
 * текст»). Every text line of the window — the title, the stage, the description, each objective — gets a pencil that
 * opens its field right there; the point lines and the requirements get a pencil that opens their editor. A saved text
 * is every player's in the interface language the owner uses (src/data/questTextOverrides.ts), as in «Тексты».
 * Players' windows are unchanged: without the provider the lines are plain text.
 */
interface SheetEdit { questId: string }
const SheetEditContext = createContext<SheetEdit | null>(null)

export function QuestSheetEditProvider({ questId, enabled, children }: { questId: string; enabled: boolean; children: ReactNode }) {
  return <SheetEditContext.Provider value={enabled ? { questId } : null}>{children}</SheetEditContext.Provider>
}

/** The pencil to the right of a line. */
export function SheetPencil({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-button sheet-pencil" onClick={(event) => { event.stopPropagation(); onClick() }} aria-label={uiText(label)} title={uiText(label)}>
      <Pencil size={12} />
    </button>
  )
}

const FIELD_LABEL: Record<QuestTextField, string> = {
  name: 'Название квеста',
  description: 'Описание квеста',
  objective: 'Цель',
  'stage-title': 'Заголовок этапа',
  'stage-description': 'Задача этапа',
}

/**
 * One text of the quest window: the text itself, and while editing a pencil that turns it into its field (Enter /
 * Ctrl+Enter saves). `children`: how the line is shown (defaults to the text).
 */
export function EditableText({ field, target = '', value, multiline = field !== 'name' && field !== 'stage-title', children }: {
  field: QuestTextField; target?: string; value: string; multiline?: boolean; children?: ReactNode
}) {
  const edit = useContext(SheetEditContext)
  const [open, setOpen] = useState(false)
  if (!edit) return <>{children ?? uiText(value)}</>
  if (open) return <EditableField questId={edit.questId} field={field} target={target} value={value} multiline={multiline} onClose={() => setOpen(false)} />
  return (
    <span className="sheet-editable">
      <span>{children ?? uiText(value)}</span>
      <SheetPencil label={`Изменить: ${FIELD_LABEL[field].toLowerCase()}`} onClick={() => setOpen(true)} />
    </span>
  )
}

function EditableField({ questId, field, target, value, multiline, onClose }: { questId: string; field: QuestTextField; target: string; value: string; multiline: boolean; onClose: () => void }) {
  const { locale } = useLocale()
  const lang = locale === 'en' ? 'en' : 'ru'
  const overrides = useQuestTextOverrides(true)
  const writer = useQuestTextWriter()
  const override = findQuestText(overrides, questId, field, target, lang)
  const label = `${FIELD_LABEL[field]} · ${lang === 'en' ? 'English' : 'русский'}`
  return (
    <span className="sheet-editable-field" onClick={(event) => event.stopPropagation()}>
      <QuestTextRow
        spec={{ field, target, label, value, multiline }}
        override={override}
        onSave={(text) => writer.save({ questId, field, target, lang, text })}
        onReset={override ? () => writer.reset(override.id) : undefined}
        onClose={onClose}
      />
    </span>
  )
}
