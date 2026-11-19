import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { BuildBench, pathKey, shownLayout } from '../arsenal/BuildBench'
import { installReplacing, removePart } from '../arsenal/buildModel'
import { useBuildDrawing } from '../arsenal/BuildPicture'
import { computeStats, type PurchaseAccess } from '../arsenal/buildStats'
import type { GunCatalog, Weapon } from '../arsenal/gunTypes'
import { ModGrid } from '../arsenal/ModGrid'
import { BuildImage } from './BuildImage'
import { assembleGuideBuild } from './guideBuild'

/**
 * A Gunsmith task's build in the same bench as «Сборка оружия» (owner, 20.11.2026: «человек открывает оружейника, а там такое же
 * интерактивное окно сборки оружия… может потыкать, посмотреть… сборку собирая в точности по скриншотам… а ниже этой сборки…
 * скриншот. Маленькое окошечко. Скриншот сборки назови»): the guide's build put together part by part (src/gunsmith/guideBuild.ts),
 * every module can be changed in the window at its cell, «Сборка из задания» puts it back; the screenshot small below it.
 */
export function GuideBuildBench({ weapon, catalog, partIds, access, screenshot, alt, onScreenshotError }: {
  weapon: Weapon
  catalog: GunCatalog
  partIds: readonly string[]
  access?: PurchaseAccess
  screenshot?: string
  alt: string
  onScreenshotError?: () => void
}) {
  const guide = useMemo(() => assembleGuideBuild(weapon, partIds, catalog).build, [catalog, partIds, weapon])
  const [state, setState] = useState({ guide, build: guide })
  // a new task or a new catalogue starts from the guide's build again
  const build = state.guide === guide ? state.build : guide
  const setBuild = (next: typeof build) => setState({ guide, build: next })
  const [selected, setSelected] = useState<string | null>(null)
  const drawing = useBuildDrawing(build)
  const stats = computeStats(build, weapon, catalog)
  const layout = shownLayout(build, weapon, catalog, selected)
  const selectedCell = layout.cells.find((cell) => pathKey(cell.path) === selected)
  const changed = build !== guide
  const pickAt = (anchor: () => Element | null, avoid: () => DOMRect | null) => selectedCell
    ? <ModGrid key={selected} cell={selectedCell} build={build} weapon={weapon} catalog={catalog} stats={stats} access={access ?? { traderLevel: 4, flea: true }} anchor={anchor} avoid={avoid}
      onPick={(itemId) => { const done = installReplacing(build, selectedCell.path, selectedCell.slot, itemId, catalog, weapon); if (done) setBuild(done.build); setSelected(null) }}
      onPickKit={(kit) => { setBuild(kit.build); setSelected(null) }}
      onRemove={() => { setBuild(removePart(build, selectedCell.path)); setSelected(null) }}
      onClose={() => setSelected(null)} />
    : null
  return <div className="gs-guide">
    <BuildBench layout={layout} weapon={weapon} stats={stats} selected={selected} onSelect={setSelected} drawn={drawing.drawn} size="normal" noAmmo popover={pickAt} />
    {changed && <div className="gs-guide-tools">
      <button type="button" className="button small" onClick={() => { setBuild(guide); setSelected(null) }} title={uiText('Вернуть сборку из задания')}><RotateCcw size={13} />{uiText('Сборка из задания')}</button>
    </div>}
    {screenshot && <figure className="gs-guide-shot">
      <figcaption>{uiText('Скриншот сборки')}</figcaption>
      <BuildImage src={screenshot} alt={alt} onError={onScreenshotError} />
    </figure>}
  </div>
}
