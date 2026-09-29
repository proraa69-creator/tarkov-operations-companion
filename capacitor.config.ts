import type { CapacitorConfig } from '@capacitor/cli'

/**
 * iOS / Android app from the same React renderer (docs/mobile.md). `webDir` is the Vite build output.
 * The app talks to the owner's API server at the address set in Settings → «Адрес сервера»; plain HTTP is allowed
 * only for home-network addresses (see android/app/src/main/res/xml/network_security_config.xml and ios Info.plist).
 */
const config: CapacitorConfig = {
  appId: 'com.tarkovoperator.app',
  appName: 'Tarkov Operator',
  webDir: 'dist',
  android: {
    // The page itself is served from https://localhost; calls to a LAN server over HTTP are "mixed content".
    allowMixedContent: true,
    backgroundColor: '#060607',
  },
  plugins: {
    // Android: edge-to-edge WebView; the insets also arrive as --safe-area-inset-* (used by styles/mobile.css).
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#060607',
  },
}

export default config
