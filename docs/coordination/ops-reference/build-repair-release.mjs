import { execFileSync } from 'node:child_process'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = '/opt/raidos-repair-20261008'
const suffix = process.env.REPAIR_RELEASE_SUFFIX || 'recognition-repair'
if (!/^[a-z0-9-]+$/.test(suffix)) throw new Error('Invalid release suffix')
function run(command, args, env = {}, cwd = root) {
  console.log(`Checking/building: ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
}
run('node', ['node_modules/typescript/bin/tsc', '-b', '--pretty', 'false'])
run('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json', '--noEmit', '--pretty', 'false'])
run('node', ['--test', 'scripts/cache-item-images.test.mjs'])
run('node', ['--import', 'tsx', '--test', 'src/services/itemImageCache.test.ts'], {}, join(root, 'server'))
if (process.env.SERVER_TESTS_ALREADY_PASSED !== '1') run('npm', ['test'], {}, join(root, 'server'))
run('npm', ['run', 'build'], { OWNER_BUILD: '0' })
const endpoint = await fetch('https://raidos.app/api/v1/entitlement/public-key').then(r => {
  if (!r.ok) throw new Error(`Public key HTTP ${r.status}`)
  return r.json()
})
const env = { RAIDOS_ENTITLEMENT_PUBLIC_KEY: endpoint.publicKey }
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: '/opt/tarkov-operations-companion' }).toString().trim()
async function edition(name) {
  run('node', ['scripts/write-build-info.mjs'], { ...env, OWNER_BUILD: name === 'owner' ? '1' : '0', ...(name === 'owner' ? { OWNER_EMAILS: 'proraa69@gmail.com' } : {}) })
  const infoFile = join(root, 'dist-electron', 'build-info.json')
  const info = JSON.parse(await readFile(infoFile, 'utf8'))
  await writeFile(infoFile, JSON.stringify({ ...info, commit: `${commit}-${suffix}` }))
  const out = `release-${name}-${suffix}`
  run('node', ['node_modules/electron-builder/out/cli/cli.js', '--win', 'portable', '--x64', `--config.directories.output=${out}`], { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', WINEDEBUG: '-all', ELECTRON_BUILDER_COMPRESSION_LEVEL: '3' })
  await cp(infoFile, join(root, out, 'build-info.json'))
  if (name === 'client') run('node', ['scripts/sign-client-release.mjs', join(root, out, `Raid OS ${version}.exe`), join(root, out, 'build-info.json'), '--out', join(root, out, 'release.json')], { RAIDOS_UPDATE_SIGNING_KEY_FILE: '/root/.raidos/update-signing-key.pem' })
}
await edition('client')
await edition('owner')
console.log('Both signed-update-compatible editions built; production not changed')
