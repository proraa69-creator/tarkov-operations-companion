import { useCallback, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { BuildBench, pathKey, shownLayout } from '../arsenal/BuildBench'
import { installReplacing, presetBuild, removePart } from '../arsenal/buildModel'
import { FullBench } from '../arsenal/FullBench'
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
export function GuideBuildBench({ weapon, catalog, partIds, withoutSlots, access, screenshot, alt, onScreenshotError }: {
  weapon: Weapon
  catalog: GunCatalog
  partIds: readonly string[]
  /** The weapon's slots the build leaves empty (a stock taken off for the weight: BuildGuide.withoutSlots). */
  withoutSlots?: readonly string[]
  access?: PurchaseAccess
  screenshot?: string
  alt: string
  onScreenshotError?: () => void
}) {
  const guide = useMemo(() => assembleGuideBuild(weapon, partIds, catalog, withoutSlots).build, [catalog, partIds, weapon, withoutSlots])
  const [state, setState] = useState({ guide, build: guide })
  // a new task or a new catalogue starts from the guide's build again
  const build = state.guide === guide ? state.build : guide
  const setBuild = (next: typeof build) => setState({ guide, build: next })
  const [selected, setSelected] = useState<string | null>(null)
  // «На весь экран» and «Сложить приклад» as in «Сборка оружия» (owner, 21.11.2026: «Здесь нужно сделать кнопку «Открыть во весь
  // экран», сложить приклад»)
  const [folded, setFolded] = useState(false)
  const [full, setFull] = useState(false)
  const closeFull = useCallback(() => setFull(false), [])
  const drawing = useBuildDrawing(build, folded)
  const stats = computeStats(build, weapon, catalog)
  const stock = useMemo(() => presetBuild(weapon, catalog).build, [catalog, weapon])
  const stockStats = computeStats(stock, weapon, catalog)
  const layout = shownLayout(build, weapon, catalog, selected)
  const selectedCell = layout.cells.find((cell) => pathKey(cell.path) === selected)
  const changed = build !== guide
  const pickAt = (anchor: () => Element | null, avoid: () => DOMRect | null) => selectedCell
    ? <ModGrid key={selected} cell={selectedCell} build={build} weapon={weapon} catalog={catalog} stats={stats} access={access ?? { traderLevel: 4, flea: true }} anchor={anchor} avoid={avoid}
      onPick={(itemId, then) => { const done = installReplacing(build, selectedCell.path, selectedCell.slot, itemId, catalog, weapon); if (done) setBuild(done.build); setSelected(done && then ? pathKey(then) : null) }}
      onPickKit={(kit) => { setBuild(kit.build); setSelected(null) }}
      onRemove={() => { setBuild(removePart(build, selectedCell.path)); setSelected(null) }}
      onClose={() => setSelected(null)} />
    : null
  const bench = (size: 'normal' | 'full', maxHeight?: number) => <BuildBench layout={layout} weapon={weapon} stats={stats} selected={selected} onSelect={setSelected}
    onRemove={(path) => { setBuild(removePart(build, path)); setSelected(null) }} drawn={drawing.drawn} size={size} maxHeight={maxHeight} noAmmo
    onExpand={size === 'normal' ? () => setFull(true) : undefined} folded={folded} onFold={setFolded} popover={(size === 'full') === full ? pickAt : undefined} largeCells />
  return <div className="gs-guide">
    {bench('normal')}
    {full && <FullBench weapon={weapon} stats={stats} stock={stockStats} selected={selected} onSelect={setSelected} onClose={closeFull}>
      {(maxHeight) => bench('full', maxHeight)}
    </FullBench>}
    {changed && <div className="gs-guide-tools">
      <button type="button" className="button small" onClick={() => { setBuild(guide); setSelected(null) }} title={uiText('Вернуть сборку из задания')}><RotateCcw size={13} />{uiText('Сборка из задания')}</button>
    </div>}
    {screenshot && <figure className="gs-guide-shot">
      <figcaption>{uiText('Скриншот сборки')}</figcaption>
      <BuildImage src={screenshot} alt={alt} onError={onScreenshotError} />
    </figure>}
  </div>
}
