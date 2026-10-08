import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvedRun, deployPath, safeTarget, transaction } from './release-policy.mjs'

const sha = 'a'.repeat(40)
const run = { head_sha: sha, head_branch: 'release/production', event: 'push', status: 'completed', conclusion: 'success', head_repository: { full_name: 'owner/repo' }, path: '.github/workflows/production.yml' }
test('only successful exact production push from this repository authorizes release', () => {
  assert.equal(approvedRun(run, sha, 'owner/repo', 'release/production'), true)
  for (const change of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { conclusion: 'failure' }, { status: 'in_progress' }, { head_repository: { full_name: 'fork/repo' } }, { path: '.github/workflows/other.yml' }]) assert.equal(approvedRun({ ...run, ...change }, sha, 'owner/repo', 'release/production'), false)
})
test('source allowlist refuses credentials, traversal and unknown ownership boundaries', () => {
  for (const file of ['src/App.tsx', 'server/src/app.ts', 'website/src/main.tsx', 'package-lock.json']) assert.equal(deployPath(file), true)
  assert.equal(deployPath('docs/coordination/WORK_LOG.md'), false)
  for (const file of ['../a', '/etc/passwd', 'src/../../a', 'src/secret.pem', 'server/.env', 'server/src/a.sqlite', 'unmanaged/file']) assert.throws(() => deployPath(file))
})
test('symlink ancestors are refused, including dangling symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'raidos-release-'))
  try {
    await mkdir(join(root, 'source'))
    await symlink(join(root, 'missing'), join(root, 'source', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(safeTarget(root, 'source/linked/a.ts'), /Symlink/)
    assert.equal(await safeTarget(root, 'source/new.ts'), join(root, 'source/new.ts'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('failed publication restores all components without restoring the database', async () => {
  const state = { api: 'old', website: 'old', client: 'old', database: 'new account' }
  await assert.rejects(transaction(async () => { state.api = 'new'; state.website = 'new'; throw new Error('download check failed') }, async () => { state.api = 'old'; state.website = 'old'; state.client = 'old' }), /rolled back/)
  assert.deepEqual(state, { api: 'old', website: 'old', client: 'old', database: 'new account' })
})
test('a failed rollback is explicit and never reported as successful', async () => {
  await assert.rejects(transaction(async () => { throw new Error('publish') }, async () => { throw new Error('rollback') }), AggregateError)
})
