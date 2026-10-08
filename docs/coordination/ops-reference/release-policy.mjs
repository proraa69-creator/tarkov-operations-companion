import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, relative, sep } from 'node:path'

export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function approvedRun(run, sha, repo, branch) {
  return /^[a-f0-9]{40}$/.test(sha) && run?.head_sha === sha && run.head_branch === branch
    && run.event === 'push' && run.status === 'completed' && run.conclusion === 'success'
    && run.head_repository?.full_name === repo && run.path === '.github/workflows/production.yml'
}
export function deployPath(file) {
  if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('Unsafe source path')
  if (/(^|\/)(\.env[^/]*|[^/]*\.(sqlite|sqlite-wal|sqlite-shm|pem|key))$/i.test(file)) throw new Error('Private data path')
  if (/^(docs\/|\.github\/|CLAUDE\.md$|AGENTS\.md$|\.gitignore$)/.test(file)) return false
  if (/^(src\/|electron\/|server\/src\/|website\/(src\/|public\/)|scripts\/|public\/|build\/)/.test(file)) return true
  if (/^(package(-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.ts|index\.html|server\/(package(-lock)?\.json|tsconfig\.json)|website\/(package(-lock)?\.json|tsconfig\.json|vite\.config\.ts|index\.html))$/.test(file)) return true
  if (/^(eslint\.config\.[cm]?js|playwright\.config\.ts|capacitor\.config\.ts|\.npmrc|\.gitattributes)$/.test(file)) return false
  throw new Error(`Unsupported deployment path: ${file}`)
}
export async function safeTarget(root, file) {
  const target = resolve(root, file)
  const rel = relative(root, target)
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith(sep)) throw new Error('Escaped deployment root')
  let cursor = root
  for (const part of rel.split(sep)) {
    cursor = resolve(cursor, part)
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Symlink target: ${file}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return target
}
export async function fileHash(path) {
  try { return hash(await readFile(path)) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
export async function assertLocalTree(root) {
  async function walk(path) {
    const s = await lstat(path)
    if (s.isSymbolicLink()) {
      const resolved = await realpath(path)
      if (!resolved.startsWith(`${root}${sep}`)) throw new Error('Build artifact link escapes staging')
    } else if (s.isDirectory()) {
      for (const name of await readdir(path)) await walk(resolve(path, name))
    } else if (!s.isFile()) throw new Error('Unexpected artifact file type')
  }
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Build root is a symlink')
  await walk(root)
}
export async function transaction(publish, rollback) {
  try { return await publish() }
  catch (error) {
    try { await rollback() } catch (failure) { throw new AggregateError([error, failure], 'Release and rollback failed; preserve backup and intervene') }
    throw new Error(`Release rolled back; database preserved: ${error.message}`, { cause: error })
  }
}
