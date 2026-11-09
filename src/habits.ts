import { db, uid, type Entry, type Habit, type HabitLog } from './db';
import { addDays, dayStart, toDateKey } from './time';

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export function logId(habitId: string, date: string): string {
  return `${habitId}|${date}`;
}

export function isScheduled(h: Habit, date: string): boolean {
  return h.days.includes(new Date(dayStart(date)).getDay());
}

export function daysText(days: number[]): string {
  if (days.length === 7) return '每天';
  const s = [...days].sort();
  if (s.join() === '1,2,3,4,5') return '平日';
  if (s.join() === '0,6') return '週末';
  return '每週' + s.map((d) => WEEKDAY_LABELS[d]).join('、');
}

export async function saveHabit(h: Omit<Habit, 'id' | 'order'> & { id?: string }): Promise<void> {
  if (h.id) {
    const { id, ...rest } = h;
    // 取消連動活動時要明確清掉欄位
    await db.habits.update(id, { ...rest, activityId: rest.activityId ?? undefined });
    return;
  }
  const max = await db.habits.orderBy('order').last();
  await db.habits.add({ ...h, id: uid(), order: (max?.order ?? -1) + 1 });
}

export async function archiveHabit(id: string): Promise<void> {
  await db.habits.update(id, { archived: true });
}

/** 調整當天打勾次數（delta 可為負），回傳新的次數 */
export async function bumpHabit(habitId: string, date: string, delta: number): Promise<number> {
  const id = logId(habitId, date);
  return db.transaction('rw', db.habitLogs, async () => {
    const cur = (await db.habitLogs.get(id))?.count ?? 0;
    const count = Math.max(0, cur + delta);
    if (count === 0) await db.habitLogs.delete(id);
    else await db.habitLogs.put({ id, habitId, date, count });
    return count;
  });
}

/** 時間軸上每天出現過的活動：date → activityId 集合 */
export function activitiesByDate(entries: Entry[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const e of entries) {
    const d = toDateKey(e.start);
    if (!map.has(d)) map.set(d, new Set());
    map.get(d)!.add(e.activityId);
  }
  return map;
}

export interface HabitDay {
  /** 手動打勾次數 */
  count: number;
  /** 時間軸上有連動活動 */
  fromTimeline: boolean;
  done: boolean;
}

export function habitDay(h: Habit, date: string, logs: Map<string, HabitLog>, acts: Map<string, Set<string>>): HabitDay {
  const count = logs.get(logId(h.id, date))?.count ?? 0;
  const fromTimeline = !!h.activityId && !!acts.get(date)?.has(h.activityId);
  return { count, fromTimeline, done: count >= h.target || fromTimeline };
}

/**
 * 連續達成天數：只算排定要做的日子，沒排的日子跳過；
 * 當天還沒做完不算中斷，從前一天開始算。
 */
export function streak(h: Habit, date: string, logs: Map<string, HabitLog>, acts: Map<string, Set<string>>, maxDays = 366): number {
  let n = 0;
  let d = date;
  if (isScheduled(h, d) && !habitDay(h, d, logs, acts).done) d = addDays(d, -1);
  for (let i = 0; i < maxDays; i++, d = addDays(d, -1)) {
    if (!isScheduled(h, d)) continue;
    if (!habitDay(h, d, logs, acts).done) break;
    n++;
  }
  return n;
}
