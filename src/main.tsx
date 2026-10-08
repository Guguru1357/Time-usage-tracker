import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureSeeded } from './defaults';
import { getSettings } from './repo';
import { applyTheme } from './theme';
import './styles.css';

async function boot() {
  await ensureSeeded();
  applyTheme((await getSettings()).theme);
  // 請求持久儲存，避免系統空間不足時清掉資料
  void navigator.storage?.persist?.();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
