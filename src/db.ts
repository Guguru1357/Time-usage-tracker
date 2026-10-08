import Dexie, { type EntityTable } from 'dexie';

export interface Category {
  id: string;
  name: string;
  color: string;
  /** 需要特別標示（例如 SNS） */
  highlight: boolean;
  order: number;
}

/** 學習類活動的細節欄位類型（第二階段使用） */
export type DetailType = 'reading' | 'japanese' | 'english' | 'medical';

export interface Activity {
  id: string;
  name: string;
  color: string;
  categoryId: string;
  order: number;
  detailType?: DetailType;
  /** 長時間活動（例如睡覺）：長度快捷鍵改成 5–10 小時 */
  longDuration?: boolean;
  /** 已刪除的活動保留下來，舊紀錄才能顯示名稱 */
  archived?: boolean;
}

export interface SecondaryActivity {
  activityId: string;
  detail?: string;
}

export interface Entry {
  id: string;
  /** epoch ms */
  start: number;
  /** epoch ms，必大於 start */
  end: number;
  activityId: string;
  note?: string;
  /** 同時進行的副活動（第二階段） */
  secondary?: SecondaryActivity[];
  /** 學習細節（第二階段） */
  details?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface Reminder {
  id: string;
  label: string;
  /** 回顧哪個時段的名稱，例如「早上」 */
  periodLabel: string;
  /** HH:MM */
  time: string;
  enabled: boolean;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  id: 'main';
  /** 外觀，未設定時為淺色 */
  theme?: ThemeMode;
  /** 時間刻度（分鐘） */
  step: number;
  reminders: Reminder[];
}

export interface KV {
  key: string;
  value: unknown;
}

export class TimeLedgerDB extends Dexie {
  categories!: EntityTable<Category, 'id'>;
  activities!: EntityTable<Activity, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  kv!: EntityTable<KV, 'key'>;

  constructor(name = 'time-ledger') {
    super(name);
    this.version(1).stores({
      categories: 'id, order',
      activities: 'id, order, categoryId',
      entries: 'id, start, end, activityId',
      settings: 'id',
      kv: 'key',
    });
    // v2：預設的「睡覺」標為長時間活動
    this.version(2).upgrade((tx) =>
      tx
        .table('activities')
        .toCollection()
        .modify((a: Activity) => {
          if (a.name === '睡覺') a.longDuration = true;
        }),
    );
  }
}

export const db = new TimeLedgerDB();

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
