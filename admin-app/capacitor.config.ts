import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.raidos.adminpanel',
  appName: 'Админ панель',
  webDir: '../dist-admin',
  ios: {
    path: '../ios-admin',
    contentInset: 'never',
    backgroundColor: '#060807',
    allowsLinkPreview: false,
  },
}

export default config
