import { execFileSync } from 'node:child_process'
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hash } from './release-policy.mjs'

const ops = dirname(fileURLToPath(import.meta.url))
const run = (bin, args) => execFileSync(bin, args, { stdio: 'inherit', timeout: 120_000 })
try { execFileSync('id', ['raidos-build'], { stdio: 'ignore' }) }
catch { run('useradd', ['--system', '--create-home', '--home-dir', '/var/lib/raidos-build', '--shell', '/usr/sbin/nologin', 'raidos-build']) }
await mkdir('/usr/local/lib/raidos-release', { recursive: true, mode: 0o755 })
await mkdir('/var/lib/raidos-release', { recursive: true, mode: 0o700 })
for (const name of ['auto-release.mjs', 'release-policy.mjs']) {
  await cp(join(ops, name), `/usr/local/lib/raidos-release/${name}`)
  await chmod(`/usr/local/lib/raidos-release/${name}`, 0o644)
}
await cp('/opt/tarkov-operations-companion/scripts/sign-client-release.mjs', '/usr/local/lib/raidos-release/sign-client-release.mjs')
await cp(join(ops, 'raidos-release.service'), '/etc/systemd/system/raidos-release.service')
await cp(join(ops, 'raidos-release.timer'), '/etc/systemd/system/raidos-release.timer')
const workflow = await readFile(join(ops, 'production.yml'))
await writeFile('/etc/raidos/release-config.json', JSON.stringify({ repository: 'proraa69-creator/tarkov-operations-companion', branch: 'release/production', workflowHash: hash(workflow), ownerEmail: 'proraa69@gmail.com', buildOnDocumentationChange: true }), { mode: 0o600 })
await writeFile('/var/lib/raidos-release/state.json', JSON.stringify({ sourceCommit: 'cc1506f365b9299654ca33844124c8a7b8ceb36a', build: 1791470726409 }), { mode: 0o600 })
try { execFileSync('git', ['--git-dir', '/opt/raidos-release-mirror.git', 'rev-parse', '--is-bare-repository'], { stdio: 'ignore' }) }
catch { run('git', ['clone', '--bare', 'https://github.com/proraa69-creator/tarkov-operations-companion.git', '/opt/raidos-release-mirror.git']) }
await mkdir('/var/lib/raidos-build/.cache', { recursive: true, mode: 0o700 })
for (const name of ['electron', 'electron-builder']) await cp(`/root/.cache/${name}`, `/var/lib/raidos-build/.cache/${name}`, { recursive: true })
run('chown', ['-R', 'raidos-build:raidos-build', '/var/lib/raidos-build'])
run('systemctl', ['daemon-reload'])
console.log('Installed without starting timer; activate after GitHub gate verification')
