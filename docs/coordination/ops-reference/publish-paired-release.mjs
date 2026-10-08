import { execFileSync } from 'node:child_process'
import { createHash, verify } from 'node:crypto'
import { chmod, chown, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalUpdatePayload, embeddedPublicKey } from '/opt/tarkov-operations-companion/scripts/sign-client-release.mjs'

const root = '/opt/tarkov-operations-companion'
const stage = '/opt/raidos-repair-20261008'
const ops = dirname(fileURLToPath(import.meta.url))
const suffix = process.env.REPAIR_RELEASE_SUFFIX
if (!suffix || !/^[a-z0-9-]+$/.test(suffix)) throw new Error('Explicit release suffix required')
const patch = JSON.parse(await readFile(process.env.PATCH_BASELINE, 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(await readFile(join(stage, `release-client-${suffix}`, 'release.json'), 'utf8'))
if (manifest.edition !== 'client' || !verify(null, Buffer.from(canonicalUpdatePayload(manifest)), embeddedPublicKey(), Buffer.from(manifest.signature, 'base64'))) throw new Error('Invalid client signature')
const previous = JSON.parse(await readFile(join(root, 'website/dist/downloads/release.json'), 'utf8'))
if (manifest.build <= previous.build) throw new Error('Refusing an older build')
const exe = await readFile(join(stage, `release-client-${suffix}`, `Raid OS ${manifest.version}.exe`))
if (exe.length !== manifest.size || sha(exe) !== manifest.sha256) throw new Error('Invalid client executable')
const backup = `/etc/raidos/paired-release-${Date.now()}`
await mkdir(backup, { mode: 0o700 })
const entries = []
for (const row of patch) {
  const target = resolve(root, row.file)
  if (!target.startsWith(`${root}/`) || row.file.split('/').includes('..')) throw new Error('Unsafe patch path')
  let bytes = null
  try { bytes = await readFile(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if ((bytes ? sha(bytes) : null) !== row.hash) throw new Error(`Concurrent change: ${row.file}`)
  entries.push({ target, existed: bytes !== null, ...(bytes ? await stat(target).then(s => ({ mode: s.mode & 0o777, uid: s.uid, gid: s.gid })) : { mode: 0o644 }), hash: row.hash,
    nextHash: sha(await readFile(join(stage, row.file))) })
}
for (const target of [join(root, 'website/dist/downloads/RaidOSClient.exe'), join(root, 'website/dist/downloads/release.json'), '/opt/raidos-private/RaidOSServer.exe']) {
  const s = await stat(target)
  entries.push({ target, existed: true, mode: s.mode & 0o777, uid: s.uid, gid: s.gid })
}
for (const [index, entry] of entries.entries()) if (entry.existed) {
  entry.backup = join(backup, String(index))
  await copyFile(entry.target, entry.backup)
  await chmod(entry.backup, 0o600)
}
await writeFile(join(backup, 'files.json'), JSON.stringify(entries), { mode: 0o600 })
const run = name => execFileSync(process.execPath, [join(ops, name)], { env: process.env, stdio: 'inherit' })
async function health() {
  for (let n = 0; n < 25; n++) {
    try { const r = await fetch('https://raidos.app/api/health', { signal: AbortSignal.timeout(4000) }); const data = await r.json(); if (r.ok && data.ok && data.database) return } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('Health check failed')
}
try {
  run('deploy-weapon-story.mjs')
  run('publish-recognition-release.mjs')
  const response = await fetch('https://raidos.app/v1/goons/pvp', { signal: AbortSignal.timeout(10000) })
  const data = await response.json()
  if (!response.ok || !Array.isArray(data.recent)) throw new Error('New Goons API not reachable')
  await health()
  console.log(JSON.stringify({ pairedRelease: true, build: manifest.build, commit: manifest.commit, backup, userDatabaseReplaced: false }))
} catch (error) {
  // Restore code and release files, never the live database: new accounts must survive a failed release.
  for (const entry of entries) {
    if (entry.nextHash) {
      let bytes = null
      try { bytes = await readFile(entry.target) } catch (e) { if (e.code !== 'ENOENT') throw e }
      const current = bytes ? sha(bytes) : null
      if (current !== entry.hash && current !== entry.nextHash) throw new Error(`Concurrent edit during rollback: ${entry.target}; backup preserved at ${backup}`)
    }
  }
  for (const entry of entries) {
    if (entry.existed) {
      await copyFile(entry.backup, `${entry.target}.paired-restore`)
      await chmod(`${entry.target}.paired-restore`, entry.mode)
      await chown(`${entry.target}.paired-restore`, entry.uid, entry.gid)
      await rename(`${entry.target}.paired-restore`, entry.target)
    } else await unlink(entry.target).catch(e => { if (e.code !== 'ENOENT') throw e })
  }
  execFileSync('systemctl', ['restart', 'raidos-api'])
  await health()
  throw new Error(`Both code and releases rolled back; database preserved: ${error.message}`)
}
