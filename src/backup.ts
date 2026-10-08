import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { db, type Activity, type Category, type Entry, type Settings, type StudyDetails } from './db';
import { DEFAULT_SETTINGS } from './defaults';
import { MIN, fmtHM, toDateKey } from './time';

export interface BackupFile {
  app: 'time-ledger';
  version: 1;
  exportedAt: string;
  categories: Category[];
  activities: Activity[];
  entries: Entry[];
  settings: Settings[];
}

export async function buildBackup(): Promise<BackupFile> {
  const [categories, activities, entries, settings] = await Promise.all([
    db.categories.toArray(),
    db.activities.toArray(),
    db.entries.orderBy('start').toArray(),
    db.settings.toArray(),
  ]);
  return { app: 'time-ledger', version: 1, exportedAt: new Date().toISOString(), categories, activities, entries, settings };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function buildCsv(): Promise<string> {
  const { categories, activities, entries } = await buildBackup();
  const act = new Map(activities.map((a) => [a.id, a]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  const rows: (string | number)[][] = [['日期', '開始', '結束', '分鐘', '活動', '分類', '學習細節', '副活動', '備註']];
  const study = (d?: StudyDetails) =>
    d
      ? [
          d.title && `《${d.title}》`,
          d.progress,
          d.grammar?.length && `文法：${d.grammar.join('／')}`,
          d.vocab?.length && `單字：${d.vocab.join('／')}`,
        ]
          .filter(Boolean)
          .join(' ')
      : '';
  for (const e of entries) {
    const a = act.get(e.activityId);
    const secondary = (e.secondary ?? [])
      .map((s) => [act.get(s.activityId)?.name ?? '?', s.detail, study(s.study)].filter(Boolean).join(':'))
      .join(' / ');
    rows.push([
      toDateKey(e.start),
      fmtHM(e.start),
      toDateKey(e.end) === toDateKey(e.start) ? fmtHM(e.end) : `${toDateKey(e.end)} ${fmtHM(e.end)}`,
      Math.round((e.end - e.start) / MIN),
      a?.name ?? '（已刪除）',
      (a && cat.get(a.categoryId)?.name) ?? '未分類',
      study(e.details),
      secondary,
      e.note ?? '',
    ]);
  }
  // 加 BOM，Excel 開啟中文才不會亂碼
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

async function deliverFile(filename: string, content: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: filename, files: [res.uri], dialogTitle: '儲存或分享備份' });
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  const d = new Date();
  return `${toDateKey(d)}_${fmtHM(d.getTime()).replace(':', '')}`;
}

export async function exportJson(): Promise<void> {
  await deliverFile(`時間記帳備份_${stamp()}.json`, JSON.stringify(await buildBackup(), null, 2), 'application/json');
}

export async function exportCsv(): Promise<void> {
  await deliverFile(`時間記帳_${stamp()}.csv`, await buildCsv(), 'text/csv');
}

export function parseBackup(text: string): BackupFile {
  const data = JSON.parse(text) as Partial<BackupFile>;
  if (data.app !== 'time-ledger' || !Array.isArray(data.entries) || !Array.isArray(data.activities)) {
    throw new Error('這不是時間記帳的備份檔');
  }
  return data as BackupFile;
}

/** 以備份完全取代目前資料 */
export async function restoreBackup(b: BackupFile): Promise<void> {
  await db.transaction('rw', [db.categories, db.activities, db.entries, db.settings], async () => {
    await Promise.all([db.categories.clear(), db.activities.clear(), db.entries.clear(), db.settings.clear()]);
    await db.categories.bulkAdd(b.categories ?? []);
    await db.activities.bulkAdd(b.activities);
    await db.entries.bulkAdd(b.entries);
    await db.settings.bulkAdd(b.settings?.length ? b.settings : [structuredClone(DEFAULT_SETTINGS)]);
  });
}
