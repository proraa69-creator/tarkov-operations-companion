import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'

const root = '/opt/tarkov-operations-companion'
const probe = process.argv[2] === '--probe'
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const out = resolve((probe ? undefined : process.argv[2]) || `/tmp/raidos-claude-snapshot-${stamp}`)
if (out === root || out.startsWith(`${root}/`) || out === '/tmp' || !out.startsWith('/tmp/raidos-claude-snapshot-')) throw new Error('Unsafe snapshot output path')
const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 })
const split = value => value.toString().split('\0').filter(Boolean)
const extensions = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.css', '.json', '.html', '.md', '.sql', '.sh', '.yml', '.yaml', '.ps1', '.cmd'])
const topFiles = new Set(['package.json', 'package-lock.json', 'eslint.config.js', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.electron.json', 'tsconfig.node.json', 'server/package.json', 'server/package-lock.json', 'website/package.json', 'website/package-lock.json'])
function eligible(path) {
  return !path.split('/').some(part => /^(?:node_modules|dist|dist-electron|\.git|\.env.*|tessdata)$/.test(part))
    && (topFiles.has(path) || /^(?:src|electron|server\/src|website\/src|scripts)\//.test(path) && extensions.has(extname(path)))
}
const changed = split(git('diff', '--name-only', '-z', 'HEAD')).filter(eligible)
const untracked = split(git('ls-files', '--others', '--exclude-standard', '-z', '--', 'src', 'electron', 'server/src', 'website/src', 'scripts')).filter(eligible)
const candidates = [...new Set([...changed, ...untracked])].sort()
if (!probe) await mkdir(join(out, 'source-overlay'), { recursive: true, mode: 0o700 })
const rows = []
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function checkSecrets(path, bytes) {
  const text = bytes.toString('utf8')
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{30}/.test(text)
    || /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(text)
    || /\bgithub_pat_[A-Za-z0-9_]{50,}\b/.test(text)
    || /\bAKIA[A-Z0-9]{16}\b/.test(text)) throw new Error(`Potential secret in ${path}; snapshot stopped`)
}
for (const path of candidates) {
  const source = join(root, path)
  let info
  try { info = await lstat(source) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!info) { rows.push({ path, action: 'delete' }); continue }
  if (!info.isFile() || info.isSymbolicLink() || !(await realpath(source)).startsWith(`${root}/`)) throw new Error(`Unsafe source file: ${path}`)
  if (info.size > 8 * 1024 * 1024) throw new Error(`Unexpected large source file: ${path}`)
  const bytes = await readFile(source)
  checkSecrets(path, bytes)
  if (!probe) {
    const target = join(out, 'source-overlay', path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await cp(source, target, { preserveTimestamps: true })
  }
  rows.push({ path, action: untracked.includes(path) ? 'add' : 'replace', size: bytes.length, sha256: sha(bytes) })
}
if (!probe) {
  const patch = git('diff', '--binary', 'HEAD', '--', ...changed)
  await writeFile(join(out, 'tracked-changes.patch'), patch, { mode: 0o600 })
}
const trackedPaths = split(git('ls-files', '-z'))
const byCase = new Map()
for (const path of trackedPaths) {
  const key = path.toLowerCase()
  byCase.set(key, [...(byCase.get(key) || []), path])
}
const release = await fetch(`https://raidos.app/download/version.json?ts=${Date.now()}`, { signal: AbortSignal.timeout(20000) }).then(r => { if (!r.ok) throw new Error('Release metadata unavailable'); return r.json() })
const health = await fetch('https://raidos.app/api/health', { signal: AbortSignal.timeout(20000) }).then(r => { if (!r.ok) throw new Error('Health metadata unavailable'); return r.json() })
const service = execFileSync('systemctl', ['show', 'raidos-api', '-p', 'ActiveState', '-p', 'SubState', '-p', 'User', '-p', 'WorkingDirectory', '-p', 'EnvironmentFiles']).toString().trim()
let refs = ''
try { refs = git('ls-remote', 'origin', 'refs/heads/main', 'refs/heads/claude/*', 'refs/heads/codex/*').toString().trim() } catch { refs = 'Unavailable: do not infer GitHub is unchanged' }
for (const row of rows) if (row.action !== 'delete' && sha(await readFile(join(root, row.path))) !== row.sha256) throw new Error(`Concurrent source edit: ${row.path}`)
if (JSON.stringify(split(git('diff', '--name-only', '-z', 'HEAD')).filter(eligible)) !== JSON.stringify(changed)
  || JSON.stringify(split(git('ls-files', '--others', '--exclude-standard', '-z', '--', 'src', 'electron', 'server/src', 'website/src', 'scripts')).filter(eligible)) !== JSON.stringify(untracked)) throw new Error('Source path set changed during collection')
const capturedAt = new Date().toISOString()
const manifest = {
  format: 1, capturedAt, capturedAtBangkok: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'long' }).format(new Date(capturedAt)),
  source: { repository: 'https://github.com/proraa69-creator/tarkov-operations-companion', baseCommit: git('rev-parse', 'HEAD').toString().trim(), branch: git('branch', '--show-current').toString().trim(), remoteRefs: refs },
  release, health: { ok: health.ok, database: health.database }, service,
  sourceFileCount: rows.length, caseCollisions: [...byCase.values()].filter(paths => paths.length > 1),
  privateDataIncluded: false, credentialContentsRead: false,
  secretScreening: 'Private-key blocks, GitHub token shapes and AWS access-key shapes; not a proof of absence of every secret',
  excluded: ['Account databases/WAL/SHM', 'Environment files', 'Logs', 'Private keys', 'Built EXEs/ASAR/node_modules', 'Item screenshots and personal accounts'],
  files: rows,
}
manifest.fingerprint = sha(Buffer.from(JSON.stringify({ source: manifest.source, release, health: manifest.health, service, files: rows })))
if (probe) {
  console.log(JSON.stringify({ fingerprint: manifest.fingerprint, source: manifest.source, build: release.build, sourceFileCount: rows.length, health: manifest.health, service }))
  process.exit(0)
}
await writeFile(join(out, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
execFileSync('tar', ['-czf', join(out, 'source-overlay.tar.gz'), '-C', join(out, 'source-overlay'), '.'])
console.log(JSON.stringify({ output: out, capturedAt, sourceFileCount: rows.length, baseCommit: manifest.source.baseCommit, build: release.build, caseCollisions: manifest.caseCollisions }))
