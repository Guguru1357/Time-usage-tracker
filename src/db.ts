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
  /** 重訓類：安排時可設定肌群與組數，完成時記錄動作、重量、次數 */
  workout?: boolean;
}

/** 學習細節，欄位皆選填 */
export interface StudyDetails {
  /** 書名／教材名稱 */
  title?: string;
  /** 頁數、章節或主題 */
  progress?: string;
  /** 文法（語言類） */
  grammar?: string[];
  /** 單字（語言類） */
  vocab?: string[];
}

export interface SecondaryActivity {
  activityId: string;
  /** 一般細節（例如聽了什麼音樂） */
  detail?: string;
  /** 副活動是學習類時的細節（例如在火車上讀的書） */
  study?: StudyDetails;
}

export interface Entry {
  id: string;
  /** epoch ms */
  start: number;
  /** epoch ms，必大於 start */
  end: number;
  activityId: string;
  note?: string;
  /** 同時進行的副活動 */
  secondary?: SecondaryActivity[];
  /** 主活動是學習類時的細節 */
  details?: StudyDetails;
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

/** 安排的學習目標（閱讀可填頁數範圍） */
export interface PlanStudy {
  title?: string;
  pageFrom?: number;
  pageTo?: number;
  /** 非頁數類的進度，例如章節、主題 */
  progress?: string;
}

/** 重訓的一個動作 */
export interface WorkoutSet {
  exercise: string;
  /** kg */
  weight?: number;
  reps?: number;
  sets?: number;
}

export interface PlanResult {
  study?: PlanStudy;
  workout?: WorkoutSet[];
  note?: string;
}

/** 預先安排的行程，到時間打勾確認 */
export interface Plan {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  /** 預計長度（分鐘），完成時用來記到時間軸 */
  durationMin?: number;
  /** 顯示名稱；有活動時預設為活動名稱 */
  title: string;
  activityId?: string;
  /** 到時間發通知 */
  remind: boolean;
  /** 學習目標 */
  study?: PlanStudy;
  /** 重訓目標 */
  muscles?: string[];
  targetSets?: number;
  note?: string;
  /** 完成時間（epoch ms） */
  doneAt?: number;
  result?: PlanResult;
  /** 完成時自動新增的時間軸紀錄，取消完成時一併刪除 */
  entryId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  /** 哪幾天要做（0=週日 … 6=週六） */
  days: number[];
  /** 每天目標次數，預設 1 */
  target: number;
  /** 連動的活動：當天時間軸有這個活動就算完成 */
  activityId?: string;
  order: number;
  archived?: boolean;
}

/** 習慣的手動打勾紀錄；id = `${habitId}|${date}` */
export interface HabitLog {
  id: string;
  habitId: string;
  date: string;
  count: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  id: 'main';
  /** 外觀，未設定時為淺色 */
  theme?: ThemeMode;
  /** 自動檢查更新，未設定時為開啟 */
  autoUpdate?: boolean;
  /** 時間刻度（分鐘） */
  step: number;
  /** 安排的提醒提前幾分鐘，未設定為準時 */
  planLead?: number;
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
  plans!: EntityTable<Plan, 'id'>;
  habits!: EntityTable<Habit, 'id'>;
  habitLogs!: EntityTable<HabitLog, 'id'>;

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
    // v3：安排、習慣；預設的「重訓」標為重訓類，並加入預設習慣
    this.version(3)
      .stores({ plans: 'id, date', habits: 'id, order', habitLogs: 'id, date, habitId' })
      .upgrade(async (tx) => {
        const acts = (await tx.table('activities').toArray()) as Activity[];
        const workout = acts.find((a) => a.name === '重訓' && !a.archived);
        if (workout) await tx.table('activities').update(workout.id, { workout: true });
        if ((await tx.table('habits').count()) === 0) {
          await tx.table('habits').bulkAdd(defaultHabits(acts));
        }
      });
  }
}

/** 預設習慣；依名稱連動到現有活動 */
export function defaultHabits(activities: Activity[]): Habit[] {
  const find = (name: string) => activities.find((a) => a.name === name && !a.archived)?.id;
  const every = [0, 1, 2, 3, 4, 5, 6];
  const list: [string, string, number[], string | undefined][] = [
    ['重訓', '🏋️', [1, 3, 5], find('重訓')],
    ['彈鋼琴', '🎹', every, find('彈鋼琴')],
    ['讀日文', '🇯🇵', every, find('讀日文')],
    ['保健食品', '💊', every, undefined],
    ['家務', '🧹', every, undefined],
  ];
  return list.map(([name, emoji, days, activityId], i) => ({
    id: `habit-${i + 1}`,
    name,
    emoji,
    days,
    target: 1,
    order: i,
    ...(activityId ? { activityId } : {}),
  }));
}

export const db = new TimeLedgerDB();

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
