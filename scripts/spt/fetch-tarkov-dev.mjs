// Downloads the json.tarkov.dev files the SPT comparison reads (scripts/spt/README.md) into <dir>: tasks, their Russian and
// English dictionaries, items, maps and traders of PvP (regular), PvE and Season (pvp-season). Public files, no account.
import { mkdirSync, writeFileSync } from 'node:fs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: node scripts/spt/fetch-tarkov-dev.mjs <dir>')
mkdirSync(dir, { recursive: true })
for (const mode of ['regular', 'pve', 'pvp-season']) {
  for (const file of ['tasks', 'tasks_ru', 'tasks_en', 'items', 'items_ru', 'maps', 'traders']) {
    const response = await fetch(`https://json.tarkov.dev/${mode}/${file}`, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${mode}/${file}: HTTP ${response.status}`)
    writeFileSync(`${dir}/${mode}_${file}.json`, Buffer.from(await response.arrayBuffer()))
    console.log(`${mode}/${file}`)
  }
}
