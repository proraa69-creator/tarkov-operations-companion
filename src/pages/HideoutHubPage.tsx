import { ChevronRight, Target, Warehouse } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import '../styles/hideoutStash.css'

/**
 * «Убежище и квесты» in «Экономика» (owner, 28.10.2026: «два отдельные кнопки будут. Убежище и квесты»): one opens
 * «Что собрать для убежища», the other the same stash for the quests' items; both have «Назад» back here.
 */
export function HideoutHubPage() {
  const { raidMode } = useAppState()
  return <div className="page hideout-hub">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Экономика · ')}{raidMode === 'seasonal' ? uiText('Сезон') : raidMode.toUpperCase()}</div>
        <h1 className="page-title">{uiText('Убежище и квесты')}</h1>
        <p className="page-subtitle">{uiText('Что собрать: предметы на улучшения убежища или предметы для квестов.')}</p>
      </div>
    </header>
    <div className="hideout-hub-choices">
      <Link to="/hideout/stash" className="panel hideout-hub-choice">
        <Warehouse size={30} aria-hidden="true" />
        <span><strong>{uiText('Убежище')}</strong><small>{uiText('Предметы на уровни модулей, которые ещё не построены')}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
      <Link to="/hideout/quests" className="panel hideout-hub-choice">
        <Target size={30} aria-hidden="true" />
        <span><strong>{uiText('Квесты')}</strong><small>{uiText('Предметы для текущих, доступных и будущих квестов')}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </div>
  </div>
}
