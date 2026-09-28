import fs from 'node:fs'

const lv = JSON.parse(fs.readFileSync('electron/playerLevels.fallback.json', 'utf8'))
const body = lv.map((x) => `  { level: ${x.level}, exp: ${x.exp} },`).join('\n')
const source = `import type { PlayerLevelRow } from '../src/profile/playerProfileNormalizer.js'

export const FALLBACK_PLAYER_LEVELS: PlayerLevelRow[] = [
${body}
]
`
fs.writeFileSync('electron/playerLevels.fallback.ts', source)
console.log('wrote', lv.length)
