import { useMemo } from 'react'
import { CellPicture } from '../arsenal/BuildBench'
import type { GunPart } from '../arsenal/gunTypes'
import { RangePicker, type PickerGroup } from './RangePicker'
import { groupScopes, type ScopeGroup } from './rangeLists'
import type { ScopeData } from './rangeScope'

const GROUP_TITLES: Record<ScopeGroup, [string, string]> = {
  rings: ['Оптика на кольцах', 'Scopes in rings'],
  rail: ['Оптика на планку', 'Rail-mounted optics'],
  thermal: ['Тепловизоры', 'Thermal scopes'],
  night: ['Ночные прицелы', 'Night vision scopes'],
  service: ['Штатные прицелы', 'Service scopes'],
}

/**
 * The range's scope list with each scope's picture (owner, 23.11.2026: «добавить картинки каждого прицела, как он выглядит») in the
 * owner's groups: scopes in rings, rail optics, thermal, night vision, the service ПСО / УСП / 1П (src/range/rangeLists.ts).
 */
export function RangeScopePicker({ scopes, value, onChange, parts, lang }: {
  scopes: ScopeData[]
  value: string
  onChange: (id: string) => void
  /** The catalog's parts: a scope's picture and its mounts by its id. */
  parts: Map<string, GunPart>
  lang: 'ru' | 'en'
}) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const zooms = (scope: ScopeData) => [...new Set(scope.modes.map((mode) => mode.zoomMax && mode.zoomMax > mode.zoom ? `×${mode.zoom}–${mode.zoomMax}` : `×${mode.zoom}`))].join(' / ')
  const groups = useMemo<PickerGroup[]>(() => groupScopes(scopes, parts).map(({ group, scopes: inGroup }) => ({
    title: lang === 'en' ? GROUP_TITLES[group][1] : GROUP_TITLES[group][0],
    items: inGroup.map((scope) => {
      const part = parts.get(scope.id)
      return { id: scope.id, name: lang === 'en' ? scope.en : scope.ru, sub: zooms(scope), ...(part ? { picture: <CellPicture part={part} /> } : {}) }
    }),
  })), [scopes, parts, lang])
  return <RangePicker groups={groups} value={value} onChange={onChange} none={t('Без оптики', 'No optic')} label={t('Прицел', 'Scope')} />
}
