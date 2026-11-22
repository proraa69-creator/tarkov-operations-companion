import { useCallback, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { BuildBench, pathKey, shownLayout } from '../arsenal/BuildBench'
import { installReplacing, presetBuild, removePart } from '../arsenal/buildModel'
import { FullBench } from '../arsenal/FullBench'
import { useBuildDrawing } from '../arsenal/BuildPicture'
import { computeStats } from '../arsenal/buildStats'
import type { AmmoStats, Build, GunCatalog, Weapon } from '../arsenal/gunTypes'
import { ModGrid } from '../arsenal/ModGrid'

/**
 * The chosen build small, as in «Сборка оружия» (owner, 22.11.2026: «Включается сборка, появляется миниатюра оружия, которое
 * собрано… это окно маленькое, где можно выбрать модули. Выбираем модули, пишутся параметры»): every module changed in the window
 * at its cell, «На весь экран» for a large view; «Как сохранена» puts the chosen build back.
 */
export function RangeBuild({ weapon, catalog, start, ammo, onChange, lang }: {
  weapon: Weapon
  catalog: GunCatalog
  /** The build the weapon starts with (its default or a saved one); a new start resets the window. */
  start: Build
  ammo?: AmmoStats
  onChange: (build: Build) => void
  lang: 'ru' | 'en'
}) {
  const [state, setState] = useState({ start, build: start })
  const build = state.start === start ? state.build : start
  const setBuild = (next: Build) => { setState({ start, build: next }); onChange(next) }
  const [selected, setSelected] = useState<string | null>(null)
  const [folded, setFolded] = useState(false)
  const [full, setFull] = useState(false)
  const closeFull = useCallback(() => setFull(false), [])
  const drawing = useBuildDrawing(build, folded)
  const stats = computeStats(build, weapon, catalog, ammo)
  const stock = useMemo(() => presetBuild(weapon, catalog).build, [catalog, weapon])
  const stockStats = computeStats(stock, weapon, catalog, ammo)
  const layout = shownLayout(build, weapon, catalog, selected)
  const selectedCell = layout.cells.find((cell) => pathKey(cell.path) === selected)
  const pickAt = (anchor: () => Element | null, avoid: () => DOMRect | null) => selectedCell
    ? <ModGrid key={selected} cell={selectedCell} build={build} weapon={weapon} catalog={catalog} stats={stats} access={{ traderLevel: 4, flea: true }} anchor={anchor} avoid={avoid}
      onPick={(itemId) => { const done = installReplacing(build, selectedCell.path, selectedCell.slot, itemId, catalog, weapon); if (done) setBuild(done.build); setSelected(null) }}
      onPickKit={(kit) => { setBuild(kit.build); setSelected(null) }}
      onRemove={() => { setBuild(removePart(build, selectedCell.path)); setSelected(null) }}
      onClose={() => setSelected(null)} />
    : null
  const bench = (size: 'normal' | 'full', maxHeight?: number) => <BuildBench layout={layout} weapon={weapon} stats={stats} ammo={ammo} selected={selected} onSelect={setSelected}
    onRemove={(path) => { setBuild(removePart(build, path)); setSelected(null) }} drawn={drawing.drawn} size={size} maxHeight={maxHeight} noAmmo
    onExpand={size === 'normal' ? () => setFull(true) : undefined} folded={folded} onFold={setFolded} popover={(size === 'full') === full ? pickAt : undefined} />
  return <div className="range-build">
    {bench('normal')}
    {full && <FullBench weapon={weapon} stats={stats} stock={stockStats} selected={selected} onSelect={setSelected} onClose={closeFull}>
      {(maxHeight) => bench('full', maxHeight)}
    </FullBench>}
    {build !== start && <button type="button" className="button small range-build-reset" onClick={() => { setBuild(start); setSelected(null) }}>
      <RotateCcw size={13} /> {lang === 'en' ? 'As chosen' : 'Как выбрана'}
    </button>}
  </div>
}
