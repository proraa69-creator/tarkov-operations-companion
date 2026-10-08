import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const packet = resolve(process.argv[2])
const manifest = JSON.parse(await readFile(join(packet, 'source-manifest.json'), 'utf8'))
const archive = join(packet, 'source-overlay.tar.gz')
const tar = args => execFileSync('tar', args, { maxBuffer: 16 * 1024 * 1024 })
const entries = tar(['-tzf', archive]).toString().split(/\r?\n/).filter(Boolean)
const names = entries.map(name => name.replace(/^\.\//, '')).filter(name => name && !name.endsWith('/'))
if (entries.some(name => name.startsWith('/') || name.startsWith('\\') || name.includes('..') || name.includes(':') || name.includes('\\'))) throw new Error('Unsafe archive path')
if (tar(['-tvzf', archive]).toString().split(/\r?\n/).some(line => /^[lh]/.test(line))) throw new Error('Archive contains a link')
const expected = manifest.files.filter(row => row.action !== 'delete')
if (names.length !== expected.length || new Set(names).size !== names.length || names.some(name => !expected.some(row => row.path === name))) throw new Error('Archive file list mismatch')
let publicKey = ''
for (const row of expected) {
  const bytes = tar(['-xOzf', archive, `./${row.path}`])
  if (bytes.length !== row.size || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Hash mismatch: ${row.path}`)
  if (row.path === 'electron/updateSigningKey.ts') publicKey = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(bytes.toString())?.[0] || ''
}
const release = manifest.release
const payload = ['raidos-update-v1', release.edition, release.version, release.build, release.commit, release.size, release.sha256].join('\n')
if (!publicKey || !verify(null, Buffer.from(payload), createPublicKey(publicKey), Buffer.from(release.signature, 'base64'))) throw new Error('Published release signature mismatch')
const report = {
  verifiedAt: new Date().toISOString(), sourceFilesVerified: expected.length, deletionEntries: manifest.files.filter(row => row.action === 'delete').length,
  archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
  signedReleaseVerified: true, publishedBuild: release.build,
  safeArchivePaths: true, noArchiveLinks: true, manifestFingerprint: manifest.fingerprint,
}
await writeFile(join(packet, 'snapshot-verification.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report))
