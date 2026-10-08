import type { Reminder } from './db';

export const MIN = 60_000;
export const HOUR = 60 * MIN;

/** 'YYYY-MM-DD'（本地時間） */
export function toDateKey(d: Date | number): string {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(Date.now());
}

/** 該日本地 00:00 的 epoch ms */
export function dayStart(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 該日結束（隔天 00:00） */
export function dayEnd(dateKey: string): number {
  return dayStart(addDays(dateKey, 1));
}

export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + n));
}

/** 'HH:MM' → 一天中的分鐘數 */
export function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function fmtHM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 以某天為基準顯示時間，跨日時加註 */
export function fmtHMRel(ms: number, dateKey: string): string {
  const end = dayEnd(dateKey);
  const s = fmtHM(ms);
  if (ms === end) return '24:00';
  if (ms > end) return `隔天 ${s}`;
  if (ms < dayStart(dateKey)) return `前一天 ${s}`;
  return s;
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} 分`;
  if (m === 0) return `${h} 小時`;
  return `${h} 小時 ${m} 分`;
}

export function fmtHours(ms: number): string {
  return `${(ms / HOUR).toFixed(1)}h`;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtDateLabel(dateKey: string): string {
  const d = new Date(dayStart(dateKey));
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

/** 對齊到刻度 */
export function roundTo(ms: number, stepMin: number, mode: 'floor' | 'round' | 'ceil' = 'round'): number {
  const step = stepMin * MIN;
  // 以本地時區的整點為基準對齊
  const offset = new Date(ms).getTimezoneOffset() * MIN;
  const local = ms - offset;
  return Math[mode](local / step) * step + offset;
}

export interface Interval {
  start: number;
  end: number;
}

/** 合併重疊區間（已排序） */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ start: iv.start, end: iv.end });
  }
  return out;
}

/** 範圍內尚未被紀錄覆蓋的區段，忽略短於 minGap 的零碎空白 */
export function findGaps(range: Interval, covered: Interval[], minGapMs = 5 * MIN): Interval[] {
  if (range.end <= range.start) return [];
  const merged = mergeIntervals(
    covered
      .map((c) => ({ start: Math.max(c.start, range.start), end: Math.min(c.end, range.end) }))
      .filter((c) => c.end > c.start),
  );
  const gaps: Interval[] = [];
  let cursor = range.start;
  for (const c of merged) {
    if (c.start > cursor) gaps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < range.end) gaps.push({ start: cursor, end: range.end });
  return gaps.filter((g) => g.end - g.start >= minGapMs);
}

export interface Period {
  reminder: Reminder;
  /** 回顧範圍：上一個提醒時間（第一個從 00:00）到這個提醒時間；最後一個延伸到 24:00 */
  range: Interval;
  /** 提醒觸發時間 */
  fireAt: number;
}

/** 依提醒時間把一天切成幾個回顧時段 */
export function periodsForDay(dateKey: string, reminders: Reminder[]): Period[] {
  const base = dayStart(dateKey);
  const end = dayEnd(dateKey);
  const sorted = [...reminders].sort((a, b) => parseHM(a.time) - parseHM(b.time));
  return sorted.map((r, i) => {
    const fireAt = base + parseHM(r.time) * MIN;
    const start = i === 0 ? base : base + parseHM(sorted[i - 1].time) * MIN;
    const rangeEnd = i === sorted.length - 1 ? end : fireAt;
    return { reminder: r, range: { start, end: rangeEnd }, fireAt };
  });
}

/** 回顧時只看到「現在」為止 */
export function clipToNow(range: Interval, now = Date.now()): Interval {
  return { start: range.start, end: Math.min(range.end, Math.max(range.start, roundTo(now, 5, 'floor'))) };
}

/** 排版：重疊的區塊分到不同欄 */
export function assignLanes<T extends Interval>(items: T[]): { item: T; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: { item: T; lane: number; lanes: number }[] = [];
  let group: { item: T; lane: number; lanes: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    for (const g of group) g.lanes = laneEnds.length;
    result.push(...group);
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else laneEnds[lane] = item.end;
    group.push({ item, lane, lanes: 0 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return result;
}
