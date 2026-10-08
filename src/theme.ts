import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { ThemeMode } from './db';

const media = window.matchMedia('(prefers-color-scheme: dark)');
let current: ThemeMode = 'light';

function apply() {
  const dark = current === 'dark' || (current === 'system' && media.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141414' : '#f7f7f5');
  if (Capacitor.isNativePlatform()) {
    // Light = 淺色背景配深色圖示
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  }
}

media.addEventListener('change', () => current === 'system' && apply());

export function applyTheme(mode: ThemeMode = 'light'): void {
  current = mode;
  apply();
}
