const { execFileSync } = require('node:child_process')
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { publishAppDelta } = require('./publish-app-delta.cjs')

exports.default = async (context) => {
  if (context.electronPlatformName !== 'win32') return
  const arch = ({ 0: 'ia32', 1: 'x64', 3: 'arm64' })[context.arch]
  if (!arch) throw new Error('Unsupported Windows native architecture')
  const root = context.packager.projectDir
  const koffi = JSON.parse(readFileSync(join(root, 'node_modules/koffi/package.json'), 'utf8'))
  const name = `@koromix/koffi-win32-${arch}`
  const version = koffi.optionalDependencies[name]
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Missing pinned Koffi native version')
  const triplet = `win32_${arch}`
  let source = join(root, 'node_modules', name, triplet, 'koffi.node')
  let temporary
  try {
    if (!existsSync(source)) {
      temporary = mkdtempSync(join(tmpdir(), 'raidos-windows-native-'))
      const args = ['pack', '--ignore-scripts', '--json', `${name}@${version}`]
      const npmCli = process.env.npm_execpath
      const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const output = execFileSync(command, npmCli ? [npmCli, ...args] : args, { cwd: temporary, encoding: 'utf8', windowsHide: true, shell: !npmCli && process.platform === 'win32' })
      const [packed] = JSON.parse(output)
      execFileSync('tar', ['-xf', join(temporary, packed.filename), '-C', temporary], { windowsHide: true })
      source = join(temporary, 'package', triplet, 'koffi.node')
    }
    const binary = readFileSync(source)
    if (binary.length < 1024 || binary.toString('ascii', 0, 2) !== 'MZ') throw new Error('Windows native module is not a PE binary')
    const destination = join(context.appOutDir, 'resources', 'koffi', triplet)
    mkdirSync(destination, { recursive: true })
    copyFileSync(source, join(destination, 'koffi.node'))
    console.log(`Verified Windows Koffi ${version} (${arch}) included in release`)
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
  // After Koffi: its file in resources is part of what a partial update must match (scripts/publish-app-delta.cjs).
  publishAppDelta({ root, appOutDir: context.appOutDir })
}
