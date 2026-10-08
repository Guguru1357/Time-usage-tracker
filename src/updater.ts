import { Capacitor, CapacitorHttp, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { db } from './db';

interface ApkUpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(options: { url: string }): Promise<void>;
  addListener(event: 'progress', fn: (p: { percent: number }) => void): Promise<PluginListenerHandle>;
}

const ApkUpdater = registerPlugin<ApkUpdaterPlugin>('ApkUpdater');

const RELEASE_API = 'https://api.github.com/repos/Guguru1357/Time-usage-tracker/releases/tags/apk-latest';
const LAST_CHECK_KEY = 'update:lastCheck';
/** 自動檢查的最短間隔 */
const AUTO_INTERVAL = 6 * 60 * 60 * 1000;

/** 目前安裝的建置編號（GitHub Actions 執行編號）；本機開發為 0 */
export const CURRENT_BUILD = __BUILD_NUMBER__;

export interface UpdateInfo {
  build: number;
  notes: string;
  apkUrl: string;
  publishedAt: string;
}

/** 從 Release 名稱或內文取出建置編號 */
export function parseBuild(name: string, body: string): number {
  const m = body.match(/build:(\d+)/) ?? name.match(/#(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** 去掉 HTML 註解與多餘空行 */
export function cleanNotes(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchLatest(): Promise<UpdateInfo> {
  const res = await CapacitorHttp.get({
    url: RELEASE_API,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status !== 200) throw new Error(`無法連線到 GitHub（${res.status}）`);
  const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as {
    name: string;
    body?: string;
    published_at: string;
    assets: { name: string; browser_download_url: string }[];
  };
  const apk = data.assets.find((a) => a.name.endsWith('.apk'));
  if (!apk) throw new Error('最新版本沒有 APK 檔');
  return {
    build: parseBuild(data.name, data.body ?? ''),
    notes: cleanNotes(data.body ?? ''),
    apkUrl: apk.browser_download_url,
    publishedAt: data.published_at,
  };
}

/** 有比目前新的版本時回傳，否則 null */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const latest = await fetchLatest();
  await db.kv.put({ key: LAST_CHECK_KEY, value: Date.now() });
  return latest.build > CURRENT_BUILD ? latest : null;
}

/** 開 App 或回到 App 時呼叫；距離上次檢查不到 6 小時就略過 */
export async function autoCheck(): Promise<UpdateInfo | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const settings = await db.settings.get('main');
  if (settings?.autoUpdate === false) return null;
  const last = ((await db.kv.get(LAST_CHECK_KEY))?.value as number | undefined) ?? 0;
  if (Date.now() - last < AUTO_INTERVAL) return null;
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}

/**
 * 下載並開啟安裝畫面。
 * 第一次需要允許「安裝不明應用程式」，會先帶到設定頁並回傳 'need-permission'。
 */
export async function installUpdate(info: UpdateInfo, onProgress: (percent: number) => void): Promise<'started' | 'need-permission'> {
  if (!Capacitor.isNativePlatform()) {
    window.open(info.apkUrl, '_blank');
    return 'started';
  }
  const { allowed } = await ApkUpdater.canInstall();
  if (!allowed) {
    await ApkUpdater.openInstallSettings();
    return 'need-permission';
  }
  const handle = await ApkUpdater.addListener('progress', (p) => onProgress(p.percent));
  try {
    await ApkUpdater.downloadAndInstall({ url: info.apkUrl });
  } finally {
    await handle.remove();
  }
  return 'started';
}
