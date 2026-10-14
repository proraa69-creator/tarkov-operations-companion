import { useId } from 'react'
import { countryGroups } from '../../../src/shared/countries'
import { siteLocale, tr } from '../i18n'

/**
 * «Страна» of a registration form and of the cabinet (owner, 13.10.2026: «при регистрации нужно указать страну»): a native
 * select in three groups — «СНГ», «Европа», «Другие страны» — sorted by the name in the site's language. Nothing is
 * chosen in advance: the player picks the country himself (src/shared/countries.ts has the lists).
 */
export function CountrySelect({ value, onChange, disabled = false }: { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  const id = useId()
  const groups = countryGroups(siteLocale())
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{tr('Страна')}</label>
      <select id={id} className="input" required autoComplete="country" aria-describedby={`${id}-hint`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>{tr('Выберите страну')}</option>
        {groups.map((group) => (
          <optgroup key={group.region} label={group.label}>
            {group.countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </optgroup>
        ))}
      </select>
      <span className="field-hint" id={`${id}-hint`}>{tr('Для статистики по регионам и выбора способов оплаты.')}</span>
    </div>
  )
}
