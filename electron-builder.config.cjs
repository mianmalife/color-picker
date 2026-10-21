require('./scripts/electron-mirror.cjs')

const { build } = require('./package.json')
const electron = require('electron/package.json')
const { createRequire } = require('node:module')
const electronRequire = createRequire(require.resolve('electron/package.json'))

// Use the checksums shipped with this exact Electron npm release. This keeps
// cached builds usable without another request for the remote checksum file.
module.exports = {
  ...build,
  electronVersion: electron.version,
  electronDist: async ({ platformName, arch }) => {
    // Use Electron's downloader directly: electron-builder 26.15.3 drops some
    // electronDownload options before invoking its own downloader.
    const { downloadArtifact } = electronRequire('@electron/get')
    return downloadArtifact({
      version: electron.version,
      artifactName: 'electron',
      platform: platformName,
      arch,
      checksums: electronRequire('./checksums.json')
    })
  }
}
