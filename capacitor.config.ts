import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tw.timeledger.app',
  appName: '時間記帳',
  webDir: 'dist',
  plugins: {
    SystemBars: {
      style: 'LIGHT',
      initialViewportFitValueHint: 'cover',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_clock',
      iconColor: '#2563eb',
    },
  },
};

export default config;
