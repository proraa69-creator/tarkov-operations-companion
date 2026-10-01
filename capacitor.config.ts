import type { CapacitorConfig } from '@capacitor/cli'

/**
 * iOS / Android app from the same React renderer (docs/mobile.md). `webDir` is the Vite build output.
 * The app talks to the owner's API server at the address set in Settings → «Адрес сервера» (https://raidos.app by
 * default); plain HTTP to a home-network address is for development only (see docs/mobile.md,
 * android/app/src/main/res/xml/network_security_config.xml and ios Info.plist).
 */
const config: CapacitorConfig = {
  appId: 'com.tarkovoperator.app',
  appName: 'Raid OS',
  webDir: 'dist',
  android: {
    // The page itself is served from https://localhost; calls to a plain-HTTP server are "mixed content" and stay blocked.
    // Only a development build against a LAN server (http://192.168.x.x:8787) allows them:
    // RAIDOS_MOBILE_DEV_HTTP=1 npm run mobile:build (the value is written into the native project by `cap sync`).
    allowMixedContent: process.env.RAIDOS_MOBILE_DEV_HTTP === '1',
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
