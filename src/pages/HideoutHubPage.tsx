import { HideoutView } from '../hideout/HideoutView'
import { basePicture, pictureSize } from '../hideout/hideoutViews'
import { HideoutStashPage } from './HideoutStashPage'
import '../styles/hideoutStash.css'

/**
 * «Убежище и квесты» in «Экономика»: the hideout itself, as in the game (hideout/HideoutView.tsx, owner, 20.11.2026), under the three
 * buttons that switch to its items, the quests' items and the cultist circle (hideout/HideoutTabs.tsx, over every one of these pages).
 * Without the hideout's pictures, its items.
 */
export function HideoutHubPage() {
  if (!pictureSize || !basePicture(0)) return <HideoutStashPage />
  return <div className="page hideout-hub">
    <HideoutView />
  </div>
}
