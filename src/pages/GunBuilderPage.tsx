import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Copy, Database, Download, Eraser, FolderOpen, RefreshCw, RotateCcw, Save, Search, Share2, Trash2, Wrench } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { useGunCatalog } from '../arsenal/gunCatalog'
import { emptyBuild, installedParts, installPart, missingRequired, presetBuild, removePart } from '../arsenal/buildModel'
import { cheapestOffer, computeCost, computeStats, deltaTone, FULL_ACCESS, type BuildStats, type PurchaseAccess } from '../arsenal/buildStats'
import { decodeBuild, deleteSavedBuild, encodeBuild, loadSavedBuilds, saveBuild, type SavedBuild } from '../arsenal/buildStorage'
import { GunSlotTree } from '../arsenal/GunSlotTree'
import { formatModifier, formatRub, PartIcon, prettyCaliber, signed } from '../arsenal/gunFormat'
import type { AmmoStats, Build, GunCatalog, Weapon } from '../arsenal/gunTypes'
import type { Item } from '../domain/types'
import '../styles/gunBuilder.css'

const WEAPON_CLASSES: Array<[string, string]> = [
  ['assault-rifle', 'Штурмовые винтовки'], ['assault-carbine', 'Штурмовые карабины'], ['marksman-rifle', 'Пехотные винтовки'],
  ['sniper-rifle', 'Снайперские винтовки'], ['smg', 'Пистолеты-пулемёты'], ['shotgun', 'Дробовики'], ['machinegun', 'Пулемёты'],
  ['handgun', 'Пистолеты'], ['revolver', 'Револьверы'], ['grenade-launcher', 'Гранатомёты'],
]
const ACCESS_KEY = 'raid-os-gun-access-v1'

function readAccess(): PurchaseAccess {
  try {
    const value = JSON.parse(localStorage.getItem(ACCESS_KEY) ?? 'null') as PurchaseAccess | null
    return value && typeof value.traderLevel === 'number' ? { traderLevel: value.traderLevel, flea: value.flea !== false } : FULL_ACCESS
  } catch { return FULL_ACCESS }
}

export function GunBuilderPage() {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  const query = useGunCatalog(raidMode, locale)
  const catalog = query.data
  return <div className="page gun-builder">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Арсенал · ')}{raidMode === 'seasonal' ? uiText('Сезон') : raidMode.toUpperCase()}</div>
        <h1 className="page-title">{uiText('Сборщик оружия')}</h1>
        <p className="page-subtitle">{uiText('Соберите оружие из совместимых модулей: отдача, эргономика, вес и цена считаются сразу и сравниваются с заводской сборкой.')}</p>
      </div>
      {catalog && <span className={`tag ${catalog.source === 'cache' ? 'brass' : 'green'}`}><Database size={12} /> {uiText(catalog.source === 'cache' ? 'кэш данных' : 'данные онлайн')} · {catalog.weapons.length} {uiText('оружия')} · {catalog.mods.size} {uiText('модулей')}</span>}
    </header>
    {query.isLoading && <div className="empty-state" role="status"><div><RefreshCw className="spin" size={26} /><h2>{uiText('Загружаем оружие и модули')}</h2><p>{uiText('Каталог модулей большой — он загружается только при открытии сборщика и кэшируется.')}</p></div></div>}
    {!catalog && query.isError && <div className="empty-state" role="alert"><div><AlertTriangle size={26} /><h2>{uiText('Источник данных недоступен')}</h2><p>{uiText('Не удалось загрузить оружие и модули, а сохранённой копии ещё нет.')}</p><button className="button" onClick={() => void query.refetch()}><RefreshCw size={14} />{uiText('Повторить')}</button></div></div>}
    {catalog && <Builder catalog={catalog} />}
  </div>
}

function Builder({ catalog }: { catalog: GunCatalog }) {
  const { raidMode } = useAppState()
  const { data } = useTarkovData()
  const [params, setParams] = useSearchParams()
  const [access, setAccessState] = useState<PurchaseAccess>(readAccess)
  const setAccess = (next: PurchaseAccess) => {
    setAccessState(next)
    try { localStorage.setItem(ACCESS_KEY, JSON.stringify(next)) } catch { /* per-viewer convenience only */ }
  }
  const initial = useMemo(() => {
    const fromCode = params.get('build') ? decodeBuild(params.get('build')!, catalog) : undefined
    if (fromCode) return fromCode
    const weapon = catalog.weapons.find((entry) => entry.id === params.get('weapon')) ?? catalog.weapons[0]
    return presetBuild(weapon, catalog).build
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])
  const [build, setBuild] = useState<Build>(initial)
  const weapon = catalog.weapons.find((entry) => entry.id === build.weaponId) ?? catalog.weapons[0]

  const selectWeapon = (next: Weapon) => {
    setBuild(presetBuild(next, catalog).build)
    setParams((current) => { const value = new URLSearchParams(current); value.set('weapon', next.id); value.delete('build'); return value }, { replace: true })
  }

  const ammoOptions = useAmmoOptions(catalog, weapon, data.items)
  const ammo = ammoOptions.find((entry) => entry.id === build.ammoId)
  const stats = computeStats(build, weapon, catalog, ammo)
  const preset = useMemo(() => weapon.defaultPreset ? presetBuild(weapon, catalog).build : undefined, [catalog, weapon])
  const presetStats = preset ? computeStats({ ...preset, ammoId: build.ammoId }, weapon, catalog, ammo) : undefined
  const cost = computeCost(build, weapon, catalog, access)
  const presetCost = preset ? computeCost(preset, weapon, catalog, access) : undefined
  const missing = missingRequired(build, weapon, catalog)
  const isPreset = preset ? encodeBuild({ ...preset, ammoId: undefined }, catalog) === encodeBuild({ ...build, ammoId: undefined }, catalog) : false

  return <div className="gb-layout">
    <WeaponPicker catalog={catalog} selected={weapon.id} onSelect={selectWeapon} />

    <section className="panel gb-workbench">
      <div className="gb-weapon-hero">
        <div className="gb-weapon-image">
          {weapon.imageLink ? <WeaponImage key={weapon.id} src={weapon.imageLink} /> : <PartIcon size="large" />}
          {weapon.defaultPreset && !isPreset && <small className="gb-image-note">{uiText('Изображение заводской сборки')}</small>}
        </div>
        <div className="gb-weapon-meta">
          <h2>{weapon.name}</h2>
          <div className="gb-meta-tags">
            <span className="tag">{weapon.weaponClassName || uiText('Оружие')}</span>
            <span className="tag">{prettyCaliber(weapon.caliber)}</span>
            {weapon.fireRate > 0 && <span className="tag">{weapon.fireRate} {uiText('выстр/мин')}</span>}
            <span className="tag">{stats.partCount} {uiText('модулей')}</span>
          </div>
          <div className="gb-actions">
            <button className="button small" disabled={!preset} onClick={() => preset && setBuild({ ...preset, ammoId: build.ammoId })}><RotateCcw size={13} />{uiText('Заводская сборка')}</button>
            <button className="button small ghost" onClick={() => setBuild({ ...emptyBuild(weapon), ammoId: build.ammoId })}><Eraser size={13} />{uiText('Пустая')}</button>
          </div>
        </div>
      </div>
      {missing.length > 0 && <div className="gb-alert" role="status"><AlertTriangle size={14} />{uiText('Не установлены обязательные модули')}: {missing.map((entry) => entry.slot.name).join(', ')}</div>}
      <div className="gb-tree-wrap">
        <GunSlotTree part={weapon} build={build} catalog={catalog} access={access}
          onInstall={(path, itemId) => setBuild((current) => installPart(current, path, itemId, catalog))}
          onRemove={(path) => setBuild((current) => removePart(current, path))} />
        {!weapon.slots.length && <p className="muted">{uiText('У этого оружия нет слотов для модулей.')}</p>}
      </div>
    </section>

    <aside className="gb-side">
      <StatsPanel stats={stats} base={presetStats} cost={cost.total} baseCost={presetCost?.total} />
      <AmmoPanel options={ammoOptions} selected={build.ammoId} access={access} onSelect={(ammoId) => setBuild((current) => ({ ...current, ammoId }))} />
      <CostPanel cost={cost} access={access} onAccess={setAccess} />
      <SavePanel key={raidMode} build={build} weapon={weapon} catalog={catalog} stats={stats} total={cost.total} onLoad={setBuild} />
    </aside>
  </div>
}

function WeaponImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? <PartIcon size="large" /> : <img src={src} alt="" onError={() => setFailed(true)} />
}

function WeaponPicker({ catalog, selected, onSelect }: { catalog: GunCatalog; selected: string; onSelect: (weapon: Weapon) => void }) {
  const [query, setQuery] = useState('')
  const [weaponClass, setWeaponClass] = useState('all')
  const classes = useMemo(() => {
    const present = new Map<string, string>()
    for (const weapon of catalog.weapons) present.set(weapon.weaponClass, weapon.weaponClassName)
    const known = WEAPON_CLASSES.filter(([key]) => present.has(key))
    const other = [...present.entries()].filter(([key]) => !WEAPON_CLASSES.some(([known]) => known === key))
    return [...known, ...other]
  }, [catalog])
  const rows = catalog.weapons.filter((weapon) => (weaponClass === 'all' || weapon.weaponClass === weaponClass)
    && (!query.trim() || `${weapon.name} ${weapon.shortName} ${prettyCaliber(weapon.caliber)}`.toLowerCase().includes(query.trim().toLowerCase())))
  return <section className="panel gb-picker">
    <div className="panel-header"><div className="panel-title">{uiText('Оружие')}</div><span className="dim">{rows.length}</span></div>
    <div className="gb-picker-body">
      <label className="gb-search"><Search size={14} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Название или калибр…')} aria-label={uiText('Поиск оружия')} /></label>
      <select className="select" value={weaponClass} onChange={(event) => setWeaponClass(event.target.value)} aria-label={uiText('Класс')}>
        <option value="all">{uiText('Все классы')}</option>
        {classes.map(([key, label]) => <option key={key} value={key}>{uiText(WEAPON_CLASSES.find(([known]) => known === key)?.[1] ?? label)}</option>)}
      </select>
      <div className="gb-weapon-list">
        {rows.map((weapon) => <button key={weapon.id} className={`gb-weapon-row${weapon.id === selected ? ' active' : ''}`} onClick={() => onSelect(weapon)}>
          <PartIcon src={weapon.iconLink} />
          <span className="gb-part-text"><strong>{weapon.shortName}</strong><small>{prettyCaliber(weapon.caliber)}</small></span>
        </button>)}
        {!rows.length && <p className="muted gb-none">{uiText('Оружие не найдено.')}</p>}
      </div>
    </div>
  </section>
}

function StatsPanel({ stats, base, cost, baseCost }: { stats: BuildStats; base?: BuildStats; cost: number; baseCost?: number }) {
  const rows: Array<{ label: string; value: string; delta?: number; kind: Parameters<typeof deltaTone>[0]; digits?: number; bar?: number; format?: (value: number) => string }> = [
    { label: 'Вертикальная отдача', value: String(stats.recoilVertical), delta: base && stats.recoilVertical - base.recoilVertical, kind: 'recoil' },
    { label: 'Горизонтальная отдача', value: String(stats.recoilHorizontal), delta: base && stats.recoilHorizontal - base.recoilHorizontal, kind: 'recoil' },
    { label: 'Эргономика', value: String(stats.ergonomics), delta: base && stats.ergonomics - base.ergonomics, kind: 'ergonomics', bar: stats.ergonomics },
    { label: 'Точность ≈ MOA', value: stats.moa !== undefined ? stats.moa.toFixed(2) : '—', delta: base?.moa !== undefined && stats.moa !== undefined ? stats.moa - base.moa : undefined, kind: 'moa', digits: 2 },
    { label: 'Вес', value: `${stats.weight.toFixed(2)} ${uiText('кг')}`, delta: base && stats.weight - base.weight, kind: 'weight', digits: 2 },
    { label: 'Стоимость', value: formatRub(cost), delta: baseCost !== undefined ? cost - baseCost : undefined, kind: 'cost', format: (value) => `${value > 0 ? '+' : '−'}${formatRub(Math.abs(value))}` },
  ]
  return <section className="panel gb-stats">
    <div className="panel-header"><div className="panel-title">{uiText('Характеристики')}</div><span className="dim">{base ? uiText('против заводской') : ''}</span></div>
    <div className="panel-body">
      {rows.map((row) => {
        const tone = row.delta !== undefined ? deltaTone(row.kind, row.delta) : 'same'
        return <div className="gb-stat" key={row.label}>
          <span className="gb-stat-label">{uiText(row.label)}</span>
          <strong className="gb-stat-value mono">{row.value}</strong>
          <span className={`gb-delta ${tone}`}>{row.delta === undefined || tone === 'same' ? '' : row.format ? row.format(row.delta) : signed(row.delta, row.digits ?? 0)}</span>
          {row.bar !== undefined && <span className="gb-bar"><span style={{ width: `${row.bar}%` }} /></span>}
        </div>
      })}
      <p className="gb-footnote">{uiText('Отдача: база × (1 + Σ модификаторов модулей и патрона), по вики Escape from Tarkov. Сумма модификаторов')}: <strong>{formatModifier(stats.recoilModifierSum)}</strong>. {uiText('MOA — приблизительная оценка по стволу, без навыков и разброса патрона.')}</p>
    </div>
  </section>
}

function useAmmoOptions(catalog: GunCatalog, weapon: Weapon, items: Item[]): AmmoStats[] {
  return useMemo(() => {
    const live = catalog.ammo.filter((ammo) => ammo.caliber === weapon.caliber)
    if (live.length) return live.sort((a, b) => b.penetration - a.penetration)
    // GraphQL ammo unavailable: the main catalogue's ammo (damage and penetration only).
    return items.filter((item) => item.category === 'Боеприпас' && item.caliber === weapon.caliber).map((item) => ({
      id: item.id, name: item.name, shortName: item.shortName, iconLink: item.iconUrl, caliber: weapon.caliber, damage: item.damage ?? 0, penetration: item.penetration ?? 0,
      armorDamage: 0, fragmentationChance: 0, initialSpeed: 0, projectileCount: 1, recoilModifier: 0, accuracyModifier: 0, tracer: false,
      offers: item.fleaPrice ? [{ vendor: 'flea-market', vendorName: 'Барахолка', priceRUB: item.fleaPrice }] : [], noFlea: false,
    } satisfies AmmoStats)).sort((a, b) => b.penetration - a.penetration)
  }, [catalog.ammo, items, weapon.caliber])
}

function AmmoPanel({ options, selected, access, onSelect }: { options: AmmoStats[]; selected?: string; access: PurchaseAccess; onSelect: (id: string) => void }) {
  return <section className="panel gb-ammo">
    <div className="panel-header"><div className="panel-title">{uiText('Боеприпасы')}</div><span className="dim">{options.length}</span></div>
    <div className="panel-body gb-ammo-body">
      {!options.length && <p className="muted">{uiText('Нет данных о патронах этого калибра.')}</p>}
      {options.length > 0 && <table className="gb-ammo-table">
        <thead><tr><th>{uiText('Патрон')}</th><th title={uiText('Урон')}>{uiText('Урон')}</th><th title={uiText('Пробитие')}>{uiText('Проб.')}</th><th title={uiText('Урон броне')}>{uiText('Броня')}</th><th title={uiText('Скорость, м/с')}>{uiText('м/с')}</th><th>{uiText('Цена')}</th></tr></thead>
        <tbody>{options.map((ammo) => {
          const offer = cheapestOffer(ammo, access)
          return <tr key={ammo.id} className={ammo.id === selected ? 'selected-row' : ''} onClick={() => onSelect(ammo.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(ammo.id) }} aria-selected={ammo.id === selected}>
            <td><span className="gb-ammo-name"><PartIcon src={ammo.iconLink} /><span>{ammo.shortName}{ammo.recoilModifier !== 0 && <small className={ammo.recoilModifier < 0 ? 'gb-good' : 'gb-bad'}> {formatModifier(ammo.recoilModifier)}</small>}</span></span></td>
            <td className="mono">{ammo.projectileCount > 1 ? `${ammo.damage}×${ammo.projectileCount}` : ammo.damage}</td>
            <td className="mono"><span className={`gb-pen pen-${Math.min(6, Math.floor(ammo.penetration / 10))}`}>{ammo.penetration}</span></td>
            <td className="mono">{ammo.armorDamage || '—'}</td>
            <td className="mono">{ammo.initialSpeed ? Math.round(ammo.initialSpeed) : '—'}</td>
            <td className="mono">{offer ? formatRub(offer.priceRUB) : <span className="gb-warn">—</span>}</td>
          </tr>
        })}</tbody>
      </table>}
    </div>
  </section>
}

function CostPanel({ cost, access, onAccess }: { cost: ReturnType<typeof computeCost>; access: PurchaseAccess; onAccess: (next: PurchaseAccess) => void }) {
  return <section className="panel gb-cost">
    <div className="panel-header"><div className="panel-title">{uiText('Где купить')}</div><strong className="mono">{formatRub(cost.total)}</strong></div>
    <div className="panel-body">
      <div className="gb-access">
        <label>{uiText('Лояльность торговцев')} <select className="select" value={access.traderLevel} onChange={(event) => onAccess({ ...access, traderLevel: Number(event.target.value) })}>{[1, 2, 3, 4].map((level) => <option key={level} value={level}>LL{level}</option>)}</select></label>
        <label className="gb-check"><input type="checkbox" checked={access.flea} onChange={(event) => onAccess({ ...access, flea: event.target.checked })} /> {uiText('Барахолка доступна')}</label>
      </div>
      <ul className="gb-cost-lines">
        {cost.lines.map((line, index) => <li key={`${line.part.id}-${index}`}>
          <span className="gb-cost-name">{line.part.shortName}</span>
          <span className="dim">{line.offer ? (line.offer.vendor === 'flea-market' ? uiText('Барахолка') : `${line.offer.vendorName} LL${line.offer.minTraderLevel ?? 1}`) : <span className="gb-warn">{uiText(line.part.noFlea ? 'запрет барахолки' : 'нет в продаже')}</span>}</span>
          <span className="mono">{line.offer ? formatRub(line.offer.priceRUB) : '—'}</span>
        </li>)}
      </ul>
      {cost.unavailable.length > 0 && <p className="gb-footnote gb-warn">{uiText('Без цены (бартер, крафт или нужна лояльность выше)')}: {cost.unavailable.length}</p>}
    </div>
  </section>
}

function SavePanel({ build, weapon, catalog, stats, total, onLoad }: { build: Build; weapon: Weapon; catalog: GunCatalog; stats: BuildStats; total: number; onLoad: (build: Build) => void }) {
  const { raidMode } = useAppState()
  const [saved, setSaved] = useState<SavedBuild[]>(() => loadSavedBuilds(raidMode))
  const [name, setName] = useState('')
  const [importCode, setImportCode] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 2500); return () => window.clearTimeout(timer) }, [notice])
  const code = encodeBuild(build, catalog) ?? ''
  const shareText = () => {
    const lines = installedParts(build, catalog).map(({ path, part }) => `${'  '.repeat(path.length - 1)}- ${part.name}`)
    const ammo = catalog.ammo.find((entry) => entry.id === build.ammoId)
    return [`${weapon.name}${name.trim() ? ` — «${name.trim()}»` : ''}`, ...lines, ammo ? `${uiText('Патрон')}: ${ammo.name}` : '',
      `${uiText('Отдача')} ${stats.recoilVertical}/${stats.recoilHorizontal} · ${uiText('Эргономика')} ${stats.ergonomics} · ${stats.weight.toFixed(2)} ${uiText('кг')} · ${formatRub(total)}`,
      `${uiText('Код сборки')}: ${code}`].filter(Boolean).join('\n')
  }
  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(message) } catch { setNotice('Не удалось скопировать') }
  }
  const load = (value: string) => {
    const decoded = decodeBuild(value, catalog)
    if (!decoded) { setNotice('Код не распознан'); return }
    onLoad(decoded)
    setNotice('Сборка загружена')
  }
  return <section className="panel gb-save">
    <div className="panel-header"><div className="panel-title">{uiText('Сборки')}</div><span className="dim">{raidMode === 'seasonal' ? uiText('Сезон') : raidMode.toUpperCase()}</span></div>
    <div className="panel-body">
      <div className="gb-row">
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={uiText('Название сборки')} aria-label={uiText('Название сборки')} />
        <button className="button small primary" disabled={!code} onClick={() => { setSaved(saveBuild(raidMode, { name: name.trim() || weapon.shortName, weaponId: weapon.id, code })); setNotice('Сохранено') }}><Save size={13} />{uiText('Сохранить')}</button>
      </div>
      <div className="gb-row">
        <button className="button small" disabled={!code} onClick={() => void copy(code, 'Код скопирован')}><Share2 size={13} />{uiText('Копировать код')}</button>
        <button className="button small" onClick={() => void copy(shareText(), 'Текст скопирован')}><Copy size={13} />{uiText('Копировать текстом')}</button>
      </div>
      {code && <code className="gb-code" aria-label={uiText('Код сборки')}>{code}</code>}
      <div className="gb-row">
        <input className="input" value={importCode} onChange={(event) => setImportCode(event.target.value)} placeholder={uiText('Вставьте код RB1…')} aria-label={uiText('Код для загрузки')} />
        <button className="button small" disabled={!importCode.trim()} onClick={() => load(importCode)}><Download size={13} />{uiText('Загрузить')}</button>
      </div>
      {notice && <p className="gb-notice" role="status">{uiText(notice)}</p>}
      <ul className="gb-saved">
        {saved.map((entry) => {
          const savedWeapon = catalog.weapons.find((candidate) => candidate.id === entry.weaponId)
          return <li key={entry.id}>
            <PartIcon src={savedWeapon?.iconLink} />
            <span className="gb-part-text"><strong>{entry.name}</strong><small>{savedWeapon?.shortName ?? '—'} · {new Date(entry.savedAt).toLocaleDateString()}</small></span>
            <button className="icon-button" onClick={() => load(entry.code)} title={uiText('Открыть')} aria-label={uiText('Открыть')}><FolderOpen size={14} /></button>
            <button className="icon-button" onClick={() => setSaved(deleteSavedBuild(raidMode, entry.id))} title={uiText('Удалить')} aria-label={uiText('Удалить')}><Trash2 size={14} /></button>
          </li>
        })}
        {!saved.length && <li className="muted gb-none"><Wrench size={14} /> {uiText('Сохранённых сборок для этого режима пока нет.')}</li>}
      </ul>
    </div>
  </section>
}
