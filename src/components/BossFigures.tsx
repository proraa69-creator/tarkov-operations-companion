import type React from 'react'
import { useNavigate } from 'react-router-dom'
import { bossFiguresFor } from '../data/bossFigures'
import { GALLERY_BOSS_KEYS } from '../data/bossInfo'
import { bossModelUrl } from '../data/bossModels'
import { useLocale } from '../i18n/LocaleProvider'
import { useOverviewDefaults } from '../overview/overviewDefaultsStore'
import { useAppState } from '../state/AppState'

/** The bosses «Боссы» has a card of (a 3D model, in one of its sections): the page opens on his card (GalleryPage, state.boss). */
const hasCard = (key: string) => (GALLERY_BOSS_KEYS.main.includes(key) || GALLERY_BOSS_KEYS.ancient.includes(key)) && !!bossModelUrl(key)

/**
 * The bosses of the selected map standing on the right of the raid card (static stills, decorative).
 * Each still is sized by its height in body heights, so every boss is the same size per body (a raised rifle
 * or antlers just stick up further) — never squeezed to fit its slot's width.
 * The bosses follow the selected game mode (PvP / PvE / Season), e.g. Black Division patrols only in Season.
 * Decoration, nothing lights up, moves or pops up under the pointer (no `title`: AppTooltips would show it); a boss with a
 * card in «Боссы» opens it on a click — his health,
 * gear and 3D model (owner, 27.11.2026: «нажимались, но не подсвечивались, не двигались, ничего… нажал, и открылась первая
 * карточка босса, где здоровье, вооружение… и его 3D-модель»; until then a click opened «Тактика боя», which that card leads
 * to). The owner's own list of a map («Админ панель» → «Блоки» → «Боссы в блоке «План рейда»») replaces the built-in one.
 */
export function BossFigures({ mapId }: { mapId: string }) {
  const { locale } = useLocale()
  const { raidMode } = useAppState()
  const navigate = useNavigate()
  const own = useOverviewDefaults()?.bosses
  const figures = bossFiguresFor(mapId, raidMode, own)
  if (!figures.length) return null
  return (
    <div className={`boss-figures${figures.length >= 5 ? ' is-crowded' : ''}`} style={{ '--n': figures.length } as React.CSSProperties} key={`${mapId}-${raidMode}`}>
      {figures.map((figure, index) => (
        <figure key={figure.key} className="boss-figure" style={{ zIndex: figures.length - Math.abs(index - (figures.length - 1) / 2) * 2, '--fig-h': figure.height } as React.CSSProperties}>
          {hasCard(figure.key)
            ? <button type="button" className="boss-figure-link" onClick={() => navigate('/gallery', { state: { boss: figure.key } })}>
                <img src={figure.url} alt={locale === 'en' ? figure.name.en : figure.name.ru} draggable={false} />
              </button>
            : <img src={figure.url} alt={locale === 'en' ? figure.name.en : figure.name.ru} draggable={false} />}
        </figure>
      ))}
    </div>
  )
}
