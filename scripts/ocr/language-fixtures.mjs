#!/usr/bin/env node
/**
 * Writes src/import/__fixtures__/gameLanguageOcr.ts: real Tesseract output (tesseract.js, tessdata_fast, the models and
 * page modes the app reads with: electron/screenOcr.ts, electron/collectorScan.ts) on pictures of the game's screens in
 * German, Japanese and Simplified Chinese drawn from the game's own words (src/import/gameWords.ts, tarkov.dev's names):
 * the Tasks table, the traders' screen, the exit list, the item tooltip, the stash labels, the flea's lines, the mode
 * cards. Not screenshots of the game — its font (Bender) is not on this PC: Bahnschrift, Yu Gothic UI and Microsoft
 * YaHei UI stand in for it, light on dark as the menus are. The real screens are to be checked on the player's
 * screenshots (docs: the list in the work log).
 *
 *   node scripts/ocr/language-fixtures.mjs [work folder]     (Windows: the pictures are drawn by PowerShell/GDI+)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorker } from 'tesseract.js'

const work = resolve(process.argv[2] ?? join(tmpdir(), 'raidos-language-fixtures'))
mkdirSync(work, { recursive: true })
const TESSDATA = resolve('electron/tessdata')
const FONTS = { de: 'Bahnschrift SemiCondensed', ja: 'Yu Gothic UI', zh: 'Microsoft YaHei UI' }
const MODELS = { de: 'deu+eng', ja: 'jpn+eng', zh: 'chi_sim+eng' }
const LIGHT = '#d8d8cf', DIM = '#8f8f86', GREEN = '#9acd32', DARK = '#16181a', INK = '#000000', PAPER = '#ffffff'

/** One picture: its size, background, font and texts ({ x, y, text, size?, color? }); `read`: how the app reads it. */
const picture = (name, language, width, height, texts, read, options = {}) => ({ name, language, width, height, texts, read, background: options.background ?? DARK, font: options.font ?? FONTS[language], size: options.size ?? 20, color: options.color ?? LIGHT })

/**
 * The Tasks table: the character's tabs, the column heads, four rows (title, location, status, progress). The trader and
 * type columns are pictures in the game (a portrait, an icon): no text there.
 */
function table(language, heads, rows, tabs, panel) {
  const xs = [40, 190, 330, 940, 1170, 1380]
  const texts = [
    ...tabs.map((text, index) => ({ x: 40 + index * 230, y: 20, text, size: 18 })),
    { x: 1180, y: 70, text: panel, size: 17, color: DIM },
    ...heads.map((text, index) => ({ x: xs[index], y: 120, text, size: 17, color: DIM })),
  ]
  rows.forEach((row, line) => row.forEach((text, index) => { if (text) texts.push({ x: xs[[2, 3, 4, 5][index]], y: 170 + line * 56, text, color: index === 2 ? GREEN : LIGHT }) }))
  return picture(`${language}-tasks`, language, 1520, 420, texts, { psm: '6' })
}

/** The traders' screen: the nickname marked (you), the standing row, the strip of trader names under the portraits. */
function traders(language, you, standing, names) {
  const texts = [
    { x: 1180, y: 24, text: `Raid_OS ${you}`, size: 22 },
    { x: 1150, y: 120, text: `${standing} LVL 12`, size: 20 },
    ...names.map((text, index) => ({ x: 40 + index * 150, y: 330, text, size: 17 })),
  ]
  return picture(`${language}-traders`, language, 1600, 420, texts, { psm: '6', words: true })
}

/** The exit list (read dark on white, as electron/extractsReader.ts turns it, at twice its size). */
const exits = (language, lines) => picture(`${language}-exits`, language, 1100, 60 + lines.length * 56, lines.map((text, index) => ({ x: 30, y: 24 + index * 56, text, size: 26 })), { psm: '6' }, { background: PAPER, color: INK })

/** One line, black on white, as the item card and the flea's lines are read (TOOLTIP_OCR_PARAMETERS). */
const line = (name, language, text) => picture(name, language, Math.max(300, 40 + text.length * (language === 'de' ? 13 : 30)), 56, [{ x: 16, y: 12, text, size: 24 }], { psm: '7', tooltip: true }, { background: PAPER, color: INK })

/** Stash labels, one under the other, as electron/collectorScan.ts stacks them (sparse text). */
const labels = (language, names) => picture(`${language}-labels`, language, 420, 40 + names.length * 48, names.map((text, index) => ({ x: 20, y: 16 + index * 48, text, size: 22 })), { psm: '11', dpi: '300' }, { background: PAPER, color: INK })

const pictures = [
  table('de', ['Händler', 'Typ', 'Aufgabe', 'Standort', 'Status', 'Fortschritt'], [
    ['Debüt', 'Customs', 'Aktiv', '0%'],
    ['Geheimhaltung im Gesundheitswesen – Teil 2', 'Irgendein Ort', 'Fertig', '100%'],
    ['Kassensturz', 'Interchange', 'Aktiv', '50%'],
    ['Apotheker', 'Irgendein Ort', 'Gesperrt', '0%'],
  ], ['ÜBERSICHT', 'AUSRÜSTUNG', 'GESUNDHEIT', 'AUFGABEN'], 'Wichtige Items im Inventar (im Raid)'),
  table('ja', ['トレーダー', 'タイプ', 'タスク', '場所', '状態', '進行状況'], [
    ['Debut', 'Customs', '進行中', '0%'],
    ['Health Care Privacy - Part 2', '任意のマップ', '達成', '100%'],
    ['Shaking Up the Teller', 'Interchange', '進行中', '50%'],
    ['Pharmacist', '任意のマップ', 'ロック中', '0%'],
  ], ['全般', '装備', '健康状態', 'タスク'], '所持しているクエストアイテム(レイドに持ち出す)'),
  table('zh', ['商人', '类型', '任务', '地点', '状态', '进度'], [
    ['首秀', '海关', '进行中！', '0%'],
    ['医疗隐私 - 2', '任意地点', '已完成！', '100%'],
    ['探囊取物', '立交桥', '进行中！', '50%'],
    ['药剂师', '任意地点', '已锁定', '0%'],
  ], ['总览', '装备', '健康', '任务'], '任务物品栏（带入战局）'),
  traders('de', '(Du)', 'Aktuelles Ansehen:', ['Prapor', 'Therapist', 'Fence', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jäger']),
  traders('ja', '(あなた)', '現在の状態:', ['Prapor', 'Therapist', 'Fence', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jaeger']),
  traders('zh', '(你)', '商人当前态度:', ['Prapor', 'Therapist', 'Fence', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jaeger']),
  exits('de', ['Finde einen Ausgang', 'EXFIL01 Alte Tankstelle 0:39:54', 'EXFIL02 Wohnwagenpark 0:39:54', 'EXFIL03 ZB-1011 ??:??:??', 'EXFIL04 Lagerhaus Nr. 4 0:39:54', 'TRANSIT01 Transit zu Factory 0:39:54']),
  exits('ja', ['脱出地点を発見せよ', '脱出地点01 Old Gas Station 0:39:54', '脱出地点02 Trailer Park 0:39:54', '脱出地点03 ZB-1011 ??:??:??', '移動地点01 Transit to Factory 0:39:54']),
  exits('zh', ['找到撤离点', '撤离点01 老加油站 0:39:54', '撤离点02 拖车停车场 0:39:54', '撤离点03 4号仓库 ??:??:??', '转移点01 前往工厂 0:39:54']),
  line('de-tooltip-gpu', 'de', 'Grafikkarte'),
  line('de-tooltip-salewa', 'de', 'Salewa Erste-Hilfe-Set'),
  line('de-tooltip-chain', 'de', 'Goldene Halskette'),
  line('ja-tooltip-gpu', 'ja', 'グラフィックボード'),
  line('ja-tooltip-chain', 'ja', '金のチェーンネックレス'),
  line('ja-tooltip-surv', 'ja', 'サーヴ12 フィールド サージカルキット'),
  line('zh-tooltip-gpu', 'zh', '显示卡'),
  line('zh-tooltip-salewa', 'zh', 'Salewa急救包'),
  line('zh-tooltip-chain', 'zh', '金项链'),
  labels('de', ['Goldkette', 'Zugangsk.', 'Salewa', 'GPU']),
  labels('ja', ['GoldChain', 'Access', 'Salewa', 'GPU']),
  labels('zh', ['金链', '钥匙卡', '显卡', 'Salewa']),
  line('de-flea-condition', 'de', 'Zustand von: 100%'),
  line('de-flea-barter', 'de', 'Tauschangebote ignorieren'),
  line('de-flea-seller', 'de', 'Jäger'),
  line('de-flea-total', 'de', 'Gesamt 1670000'),
  line('ja-flea-condition', 'ja', '状態: 100%'),
  line('ja-flea-barter', 'ja', '物々交換を除外'),
  line('ja-flea-limit', 'ja', '合計 40 (上限 5)'),
  line('zh-flea-condition', 'zh', '状况从: 100%'),
  line('zh-flea-barter', 'zh', '去除交换品报价单'),
  line('zh-flea-limit', 'zh', '总计 40 (限制 5)'),
  picture('zh-modes', 'zh', 1400, 220, [
    { x: 120, y: 30, text: 'PVE区域', size: 26 }, { x: 600, y: 30, text: 'PVP区域', size: 26 },
    { x: 120, y: 130, text: 'Raid_OS | 41', size: 22 }, { x: 600, y: 130, text: 'Raid_OS | 39', size: 22 },
  ], { psm: '6', words: true }),
  picture('de-modes', 'de', 1400, 220, [
    { x: 120, y: 30, text: 'PVE-ZONE', size: 26 }, { x: 600, y: 30, text: 'PVP-ZONE', size: 26 },
    { x: 120, y: 130, text: 'Raid_OS | 41', size: 22 }, { x: 600, y: 130, text: 'Raid_OS | 39', size: 22 },
  ], { psm: '6', words: true }),
]

// The pictures, drawn by GDI+ (PowerShell): the spec as UTF-8 JSON.
const spec = join(work, 'spec.json')
writeFileSync(spec, JSON.stringify(pictures.map((entry) => ({ ...entry, file: join(work, `${entry.name}.png`) }))), 'utf8')
const draw = `
Add-Type -AssemblyName System.Drawing
$items = Get-Content -Raw -Encoding UTF8 '${spec}' | ConvertFrom-Json
foreach ($item in $items) {
  $bitmap = New-Object System.Drawing.Bitmap ([int]$item.width), ([int]$item.height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($item.background))
  foreach ($text in $item.texts) {
    $size = if ($text.size) { [float]$text.size } else { [float]$item.size }
    $color = if ($text.color) { $text.color } else { $item.color }
    $font = New-Object System.Drawing.Font ($item.font, $size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
    $graphics.DrawString($text.text, $font, $brush, [float]$text.x, [float]$text.y)
    $font.Dispose(); $brush.Dispose()
  }
  $bitmap.Save($item.file, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
}
`
execFileSync('powershell.exe', ['-NoProfile', '-Command', draw], { stdio: 'inherit' })

// Read as the app reads: one engine per language, its page mode per picture.
// The three engines of the app, each with its own parameters: the quest scanner (page mode 6), the item card's one line
// (TOOLTIP_OCR_PARAMETERS, also the flea's lines), the Kappa scan's labels (sparse text, 300 dpi).
const ENGINES = {
  quest: { tessedit_pageseg_mode: '6' },
  tooltip: { tessedit_pageseg_mode: '7', user_defined_dpi: '300', tessedit_char_blacklist: '@$®©|!?[]{}~<>*§°€£¥' },
  labels: { tessedit_pageseg_mode: '11', user_defined_dpi: '300' },
}
const engineOf = (entry) => (entry.read.tooltip ? 'tooltip' : entry.read.psm === '11' ? 'labels' : 'quest')
const results = {}
for (const language of ['de', 'ja', 'zh']) {
  for (const [engine, parameters] of Object.entries(ENGINES)) {
    const group = pictures.filter((item) => item.language === language && engineOf(item) === engine)
    if (!group.length) continue
    const worker = await createWorker(MODELS[language], 1, { langPath: TESSDATA, cachePath: TESSDATA, gzip: false })
    await worker.setParameters(parameters)
    for (const entry of group) {
      const image = readFileSync(join(work, `${entry.name}.png`))
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
      const words = (data.blocks ?? []).flatMap((block) => block.paragraphs.map((paragraph) => paragraph.lines.map((lineEntry) => lineEntry.words.map((word) => ({ text: word.text, bbox: word.bbox })))))
      results[entry.name] = { text: data.text, ...(entry.read.words || /^(ja|zh)-/.test(entry.name) ? { blocks: words } : {}), size: { width: entry.width, height: entry.height } }
    }
    await worker.terminate()
  }
}

const out = resolve('src/import/__fixtures__/gameLanguageOcr.ts')
writeFileSync(out, `/**
 * GENERATED by scripts/ocr/language-fixtures.mjs — do not edit by hand. Real Tesseract output (tesseract.js, tessdata_fast:
 * deu+eng, jpn+eng, chi_sim+eng; the page modes the app reads with) on pictures of the game's screens in German, Japanese
 * and Simplified Chinese drawn from the game's own words (src/import/gameWords.ts) and names (tarkov.dev). Not screenshots:
 * Bahnschrift, Yu Gothic UI and Microsoft YaHei UI stand in for the game's font. \`blocks\`: paragraphs → lines → words with
 * their boxes, as electron/screenOcr.ts gets them (Japanese and Chinese readings are rebuilt from them: src/shared/cjk.ts).
 */
export interface FixtureWord { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
export interface FixtureReading { text: string; blocks?: FixtureWord[][][]; size: { width: number; height: number } }

export const GAME_LANGUAGE_OCR: Record<string, FixtureReading> = ${JSON.stringify(results, null, 1)}
`, 'utf8')
console.log(`written ${out}`)
