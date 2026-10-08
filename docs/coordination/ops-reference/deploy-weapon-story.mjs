import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, chmod, stat, rename, unlink } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const root = '/opt/tarkov-operations-companion'
const stage = '/opt/raidos-repair-20261008'
const list = process.env.PATCH_LIST || '/tmp/weapon-story-files.json'
const baseline = process.env.PATCH_BASELINE || '/tmp/weapon-story-baseline.json'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const files = JSON.parse(await readFile(list, 'utf8'))
async function existing(file) {
  const target = resolve(root, file)
  if (!target.startsWith(`${root}/`)) throw new Error('Invalid patch path')
  try { return await readFile(target) } catch (error) { if (error.code !== 'ENOENT') throw error; return null }
}
if (process.argv[2] === '--snapshot') {
  let previous = []
  try { previous = JSON.parse(await readFile(baseline, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const row of previous) {
    const bytes = await existing(row.file)
    if ((bytes ? hash(bytes) : null) !== row.hash) throw new Error(`Concurrent source edit before snapshot extension: ${row.file}`)
  }
  const rows = []
  for (const file of files) { const bytes = await existing(file); rows.push({ file, hash: bytes ? hash(bytes) : null }) }
  await writeFile(baseline, JSON.stringify(rows), { mode: 0o600 })
  console.log(`Snapshotted ${rows.length} source paths`)
} else {
  const expected = JSON.parse(await readFile(baseline, 'utf8'))
  if (expected.length !== files.length || files.some(file => !expected.some(row => row.file === file))) throw new Error('Patch baseline does not cover every source file')
  const changes = []
  for (const row of expected) {
    const bytes = await existing(row.file)
    if ((bytes ? hash(bytes) : null) !== row.hash) throw new Error(`Concurrent source edit: ${row.file}`)
    changes.push({ file: row.file, target: join(root, row.file), bytes, next: await readFile(join(stage, row.file)), mode: bytes ? (await stat(join(root, row.file))).mode & 0o777 : 0o644 })
  }
  const backup = `/etc/raidos/weapon-story-before-${Date.now()}`
  await mkdir(backup, { mode: 0o700 })
  const db = new DatabaseSync('/var/lib/raidos/companion.sqlite', { readOnly: true })
  try { db.exec('PRAGMA busy_timeout=5000'); db.exec(`VACUUM INTO '${join(backup, 'companion.sqlite')}'`) } finally { db.close() }
  await chmod(join(backup, 'companion.sqlite'), 0o600)
  for (const [index, change] of changes.entries()) if (change.bytes) await writeFile(join(backup, String(index)), change.bytes, { mode: 0o600 })
  await writeFile(join(backup, 'files.json'), JSON.stringify(changes.map(({ target, mode, bytes }) => ({ target, mode, existed: !!bytes }))), { mode: 0o600 })
  async function healthy() {
    for (let n = 0; n < 20; n++) {
      try { const r = await fetch('https://raidos.app/api/health', { signal: AbortSignal.timeout(4000) }).then(r => r.json()); if (r.ok && r.database) return } catch {}
      await new Promise(r => setTimeout(r, 1000))
    }
    throw new Error('API unavailable')
  }
  try {
    for (const change of changes) { await mkdir(dirname(change.target), { recursive: true }); await writeFile(`${change.target}.new`, change.next, { mode: change.mode }); await rename(`${change.target}.new`, change.target) }
    execFileSync('systemctl', ['restart', 'raidos-api'])
    await healthy()
    const image = await fetch('https://raidos.app/item-images/5af08cf886f774223c269184-grid.webp')
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) throw new Error('Assembled M4 cache unavailable')
    console.log(JSON.stringify({ sourceFiles: changes.length, databaseBackup: true, databaseUntouched: true, apiHealthy: true, assembledWeaponCache: image.status }))
  } catch (error) {
    for (const change of changes) { if (change.bytes) { await writeFile(`${change.target}.restore`, change.bytes, { mode: change.mode }); await rename(`${change.target}.restore`, change.target) } else await unlink(change.target).catch(() => {}) }
    execFileSync('systemctl', ['restart', 'raidos-api'])
    await healthy()
    throw new Error(`Code reverted without replacing user database: ${error.message}`)
  }
}
