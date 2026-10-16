import { defaultOverviewLayout, sanitizeOverviewLayout, type OverviewLayout } from '../overview/overviewLayout'
import { PHONE_BLOCKS } from '../overview/phoneLayout'
import type { BlockTitle, OverviewDefaults } from '../overview/overviewDefaults'

/** «Админ панель» → «Блоки» (src/admin/AdminBlocksSection.tsx): the owner's draft and what is sent to the server. */
export const OVERVIEW_DEFAULTS_PATH = '/v1/accounts/me/admin/overview-defaults'

/** What the owner edits: every part filled in (the built-in values where the server has none). */
export interface BlocksDraft { layout: OverviewLayout; phone: string[]; hidden: string[]; titles: Record<string, BlockTitle> }

export function draftOf(defaults: OverviewDefaults | null | undefined): BlocksDraft {
  return {
    layout: defaults?.layout ? sanitizeOverviewLayout(defaults.layout) : defaultOverviewLayout(),
    phone: defaults?.phone ? [...defaults.phone] : [...PHONE_BLOCKS],
    hidden: [...(defaults?.hidden ?? [])],
    titles: { ...(defaults?.titles ?? {}) },
  }
}

/** The body of PUT …/overview-defaults (empty headings dropped). */
export function bodyOf(draft: BlocksDraft): OverviewDefaults {
  const titles = Object.fromEntries(Object.entries(draft.titles).map(([id, title]) => [id, { ru: title.ru.trim(), en: title.en.trim() }]).filter(([, title]) => (title as BlockTitle).ru || (title as BlockTitle).en))
  return { layout: draft.layout, phone: draft.phone, hidden: draft.hidden, titles }
}
