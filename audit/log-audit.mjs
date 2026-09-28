import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'C:/Battlestate Games/Escape from Tarkov/Logs'
const out = []
const urlCounts = new Map()
const msgTypes = new Map()
const notifTypes = new Map()
const appLines = new Map()

for (const dir of readdirSync(root).filter((d) => d.startsWith('log_')).sort()) {
  const files = readdirSync(join(root, dir))
  const read = (part) => {
    const f = files.find((name) => name.includes(part))
    return f ? readFileSync(join(root, dir, f), 'utf8') : ''
  }
  const app = read('application_')
  const backend = read('backend_')
  const push = read('push-notifications_')
  const modes = [...app.matchAll(/^(\S+ \S+)\|.*Session mode:\s*(\w+)/gm)].map((m) => `${m[1].slice(11, 19)} ${m[2]}`)
  const profiles = [...app.matchAll(/^(\S+ \S+)\|.*SelectProfile.*ProfileId:(\w+)\s+AccountId:(\d+)/gm)].map((m) => `${m[1].slice(11, 19)} ${m[2]} ${m[3]}`)
  for (const m of backend.matchAll(/(?:https?:\/\/[^/\s]+)?(\/client\/[\w/.-]+|\/launcher\/[\w/.-]+|\/[a-z]+\/[\w/.-]+)/g)) {
    const url = m[1].replace(/[a-f0-9]{24}/g, ':id')
    urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1)
  }
  for (const m of push.matchAll(/Got notification \| (\w+)/g)) notifTypes.set(m[1], (notifTypes.get(m[1]) ?? 0) + 1)
  const quests = []
  for (const m of push.matchAll(/^(\S+ \S+)\|[^\n]*Got notification \| ChatMessageReceived\s*\n(\{[\s\S]*?\n\})/gm)) {
    try {
      const j = JSON.parse(m[2])
      const t = j.message?.type
      msgTypes.set(t, (msgTypes.get(t) ?? 0) + 1)
      if ([10, 11, 12].includes(t)) quests.push(`${m[1].slice(11, 19)} t${t} ${j.message.templateId}`)
    } catch {}
  }
  for (const m of app.matchAll(/^\S+ \S+\|[^|]*\|\w+\|application\|([A-Za-z][\w ]{3,40})/gm)) {
    const k = m[1].trim()
    appLines.set(k, (appLines.get(k) ?? 0) + 1)
  }
  out.push({ dir, modes, profiles, quests })
}

const lines = []
for (const s of out) {
  lines.push(`== ${s.dir}`)
  if (s.modes.length) lines.push(`  modes: ${s.modes.join(', ')}`)
  if (s.profiles.length) lines.push(`  profiles: ${s.profiles.join(', ')}`)
  for (const q of s.quests) lines.push(`  ${q}`)
}
lines.push('', '== chat message types', JSON.stringify([...msgTypes]))
lines.push('== notification types', JSON.stringify([...notifTypes]))
lines.push('== backend urls', ...[...urlCounts].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([u, c]) => `${c} ${u}`))
lines.push('== application line heads', ...[...appLines].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([u, c]) => `${c} ${u}`))
writeFileSync('audit/log-audit.txt', lines.join('\n'))
console.log('done', out.length)
