import { uiText } from '../i18n/renderText'
import { TierListPanel } from '../screen/TierListPanel'
import { useAppState } from '../state/AppState'

/**
 * «Тир листы» in the sidebar's «Экономика» (owner, 02.11.2026: «заливай тир листы в блок экономика, название Тир листы при
 * открытии там будут сверху блоки с разными категориями»): the category blocks on top, the S…D board of the chosen one below.
 */
export function TierListsPage() {
  const { raidMode } = useAppState()
  return (
    <div className="page tier-lists-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Экономика · ')}{raidMode === 'seasonal' ? uiText('Сезон') : raidMode.toUpperCase()}</div>
          <h1 className="page-title">{uiText('Тир листы')}</h1>
          <p className="page-subtitle">{uiText('Предметы по тирам S–D в каждой категории.')}</p>
        </div>
      </header>
      <TierListPanel />
    </div>
  )
}
