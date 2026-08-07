import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.rentalmanager.app',
  appName: 'Rental Manager',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
