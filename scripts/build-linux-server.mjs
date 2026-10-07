// The Linux server bundle (docs/linux-server.md), made from what `npm run build` already put in dist-electron:
//   node scripts/build-linux-server.mjs <out dir>
// Writes <out dir>/raidos-server-<build>.tar.gz (api/server.cjs, site/site-server.cjs + site/www, bin/raidos-update.cjs,
// build-info.json, build.env, install.sh) and, when RAIDOS_UPDATE_SIGNING_KEY_FILE / RAIDOS_UPDATE_SIGNING_KEY is set,
// the signed <out dir>/RaidOS-linux.json; plus <out dir>/install.sh for the repository's linux/ folder.
// The build number is the one in dist-electron/build-info.json (run it right after the owner build, so it matches
// latest.json of the release).
import { createRequire } from 'node:module'
import { createHash, createPrivateKey } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(root, 'release', 'linux'))
const require = createRequire(join(root, 'server', 'package.json'))
const esbuild = require('esbuild')

const info = JSON.parse(await readFile(join(root, 'dist-electron', 'build-info.json'), 'utf8'))
const build = Number(info.build)
if (!build) throw new Error('dist-electron/build-info.json has no build number: run `npm run build` first')
const version = String(info.version)
const commit = String(info.commit ?? '')

const stage = join(out, 'raidos-server')
await rm(stage, { recursive: true, force: true })
await mkdir(join(stage, 'api'), { recursive: true })
await cp(join(root, 'dist-electron', 'local-server', 'server.cjs'), join(stage, 'api', 'server.cjs'))
await cp(join(root, 'dist-electron', 'website'), join(stage, 'site', 'www'), { recursive: true })

const bundle = (entry, outfile) => esbuild.build({
  stdin: { contents: `require(${JSON.stringify(entry)}).main()`, resolveDir: root, loader: 'js' },
  outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['node:*'], logLevel: 'warning', legalComments: 'none',
})
await bundle('./electron/linux/siteServer.ts', join(stage, 'site', 'site-server.cjs'))
await bundle('./electron/linux/updater.ts', join(stage, 'bin', 'raidos-update.cjs'))
await cp(join(root, 'deploy', 'linux', 'install.sh'), join(stage, 'install.sh'))

await writeFile(join(stage, 'build-info.json'), `${JSON.stringify({ version, build, commit, edition: 'linux' })}\n`)
await writeFile(join(stage, 'build.env'), [`TARKOV_APP_VERSION=${version}`, `TARKOV_APP_BUILD=${build}`, `TARKOV_APP_COMMIT=${commit}`, 'TARKOV_APP_EDITION=linux', ''].join('\n'))

const name = `raidos-server-${build}.tar.gz`
const archive = join(out, name)
await rm(archive, { force: true })
// Fixed owner and order, no timestamps in gzip: the same input gives the same bytes.
execFileSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=@0', '-C', stage, '-cf', join(out, 'bundle.tar'), '.'])
execFileSync('gzip', ['-n', '-9', '-f', join(out, 'bundle.tar')])
await cp(join(out, 'bundle.tar.gz'), archive)
await rm(join(out, 'bundle.tar.gz'), { force: true })
await rm(stage, { recursive: true, force: true })
await cp(join(root, 'deploy', 'linux', 'install.sh'), join(out, 'install.sh'))

const data = await readFile(archive)
const manifest = { version, build, commit, bundle: { name, size: (await stat(archive)).size, sha256: createHash('sha256').update(data).digest('hex') } }
const keyText = process.env.RAIDOS_UPDATE_SIGNING_KEY_FILE ? await readFile(process.env.RAIDOS_UPDATE_SIGNING_KEY_FILE, 'utf8') : process.env.RAIDOS_UPDATE_SIGNING_KEY
if (keyText) {
  // The same canonical text and checks as the updater (electron/linux/linuxManifest.ts), compiled on the fly.
  const tmp = join(out, '.linux-manifest.cjs')
  await esbuild.build({ entryPoints: [join(root, 'electron', 'linux', 'linuxManifest.ts')], outfile: tmp, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['node:*'], logLevel: 'warning' })
  const { signLinuxManifest, verifiedLinuxManifest } = require(tmp)
  await rm(tmp, { force: true })
  const signed = signLinuxManifest(manifest, createPrivateKey(keyText))
  if (!verifiedLinuxManifest(signed)) throw new Error('the signed RaidOS-linux.json does not verify with the built-in update key: wrong signing key?')
  await writeFile(join(out, 'RaidOS-linux.json'), `${JSON.stringify(signed, null, 1)}\n`)
  console.log(`Linux server → ${archive} + RaidOS-linux.json (signed)`)
} else {
  console.log(`Linux server → ${archive} (unsigned: set RAIDOS_UPDATE_SIGNING_KEY_FILE to publish it)`)
}
