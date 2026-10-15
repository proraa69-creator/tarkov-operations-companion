// Separate test edition with Hand Control. Its own app id, name and data folder, so it
// runs next to the main Raid OS build without sharing settings, and it has no auto-update.
const pkg = require('./package.json')

const productName = 'Raid OS Hand Control Test'

module.exports = {
  ...pkg.build,
  appId: 'local.raidos.handcontrol.test',
  productName,
  extraMetadata: { name: 'raidos-hand-control-test', productName },
  directories: { output: 'release-hand' },
  win: { ...pkg.build.win, artifactName: `${productName} \${version}.exe` },
  // The 3D hand models are MIT-licensed third-party assets: ship their notice with the app.
  extraResources: [
    ...(pkg.build.extraResources ?? []),
    { from: 'src/handControl/assets/LICENSE-webxr-input-profiles.md', to: 'licenses/LICENSE-webxr-input-profiles.md' },
  ],
}
