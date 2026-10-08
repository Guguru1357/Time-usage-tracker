import type { Activity, Category, DetailType, Entry, StudyDetails } from './db';
import { HOUR, addDays, dayStart, mergeIntervals, toDateKey, type Interval } from './time';

export interface CatalogLike {
  activityById: Map<string, Activity>;
  categoryById: Map<string, Category>;
}

export interface Amount {
  id: string;
  ms: number;
}

export interface StudyGroup {
  activityId: string;
  detailType: DetailType;
  ms: number;
  /** 書名／教材，依時間多寡排序 */
  titles: { title: string; ms: number; progress: string[] }[];
  /** 沒填書名的進度 */
  progress: string[];
  grammar: string[];
  vocab: string[];
}

export interface PeriodStats {
  range: Interval;
  /** 範圍內已經過的時間（今天／本週只算到現在） */
  elapsed: number;
  /** 有紀錄的時間（重疊只算一次） */
  recorded: number;
  byActivity: Amount[];
  /** id 為空字串代表未分類 */
  byCategory: Amount[];
  /** 特別標示分類（SNS）的時間，含同時進行的 */
  highlight: number;
  secondaryByActivity: Amount[];
  study: StudyGroup[];
}

/** 週一為一週開始 */
export function weekStartKey(dateKey: string): string {
  const d = new Date(dayStart(dateKey));
  const offset = (d.getDay() + 6) % 7;
  return addDays(dateKey, -offset);
}

export function dayRange(dateKey: string): Interval {
  return { start: dayStart(dateKey), end: dayStart(addDays(dateKey, 1)) };
}

export function weekRange(dateKey: string): Interval {
  const ws = weekStartKey(dateKey);
  return { start: dayStart(ws), end: dayStart(addDays(ws, 7)) };
}

/** 往前推一週的同一段（日檢視＝上週同一天，週檢視＝上週） */
export function shiftWeek(range: Interval, weeks: number): Interval {
  const shift = (ms: number) => {
    const key = addDays(toDateKey(ms), weeks * 7);
    return dayStart(key) + (ms - dayStart(toDateKey(ms)));
  };
  return { start: shift(range.start), end: shift(range.end) };
}

function sumBy(map: Map<string, number>, id: string, ms: number) {
  map.set(id, (map.get(id) ?? 0) + ms);
}

function sorted(map: Map<string, number>): Amount[] {
  return [...map.entries()].map(([id, ms]) => ({ id, ms })).sort((a, b) => b.ms - a.ms);
}

function uniq(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * 計算一段期間的統計。
 * `until` 之後的時間不算（用來比較「上週同期」，以及今天只算到現在）。
 */
export function computeStats(entries: Entry[], range: Interval, catalog: CatalogLike, until = Infinity): PeriodStats {
  const end = Math.min(range.end, Math.max(range.start, until));
  const window = { start: range.start, end };
  const byActivity = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const secondary = new Map<string, number>();
  const covered: Interval[] = [];
  const highlightIntervals: Interval[] = [];
  const study = new Map<string, StudyGroup>();

  const isHighlight = (activityId: string) => {
    const a = catalog.activityById.get(activityId);
    return !!(a && catalog.categoryById.get(a.categoryId)?.highlight);
  };

  const addStudy = (activityId: string, d: StudyDetails | undefined, ms: number) => {
    const type = catalog.activityById.get(activityId)?.detailType;
    if (!type) return;
    let g = study.get(activityId);
    if (!g) {
      g = { activityId, detailType: type, ms: 0, titles: [], progress: [], grammar: [], vocab: [] };
      study.set(activityId, g);
    }
    g.ms += ms;
    if (d?.title) {
      let t = g.titles.find((x) => x.title === d.title);
      if (!t) g.titles.push((t = { title: d.title, ms: 0, progress: [] }));
      t.ms += ms;
      if (d.progress) t.progress.push(d.progress);
    } else if (d?.progress) g.progress.push(d.progress);
    g.grammar.push(...(d?.grammar ?? []));
    g.vocab.push(...(d?.vocab ?? []));
  };

  for (const e of entries) {
    const s = Math.max(e.start, window.start);
    const t = Math.min(e.end, window.end);
    if (t <= s) continue;
    const ms = t - s;
    covered.push({ start: s, end: t });
    sumBy(byActivity, e.activityId, ms);
    const a = catalog.activityById.get(e.activityId);
    sumBy(byCategory, a && catalog.categoryById.has(a.categoryId) ? a.categoryId : '', ms);
    if (isHighlight(e.activityId)) highlightIntervals.push({ start: s, end: t });
    addStudy(e.activityId, e.details, ms);
    for (const x of e.secondary ?? []) {
      sumBy(secondary, x.activityId, ms);
      if (isHighlight(x.activityId)) highlightIntervals.push({ start: s, end: t });
      addStudy(x.activityId, x.study, ms);
    }
  }

  const total = (list: Interval[]) => mergeIntervals(list).reduce((sum, iv) => sum + iv.end - iv.start, 0);

  return {
    range,
    elapsed: window.end - window.start,
    recorded: total(covered),
    byActivity: sorted(byActivity),
    byCategory: sorted(byCategory),
    highlight: total(highlightIntervals),
    secondaryByActivity: sorted(secondary),
    study: [...study.values()]
      .map((g) => ({
        ...g,
        titles: g.titles.sort((a, b) => b.ms - a.ms).map((t) => ({ ...t, progress: uniq(t.progress) })),
        progress: uniq(g.progress),
        grammar: uniq(g.grammar),
        vocab: uniq(g.vocab),
      }))
      .sort((a, b) => b.ms - a.ms),
  };
}

/** 每天特別標示（SNS）的時間 */
export function dailyHighlight(entries: Entry[], weekStart: string, catalog: CatalogLike, until = Infinity): number[] {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(weekStart, i);
    return computeStats(entries, dayRange(key), catalog, until).highlight;
  });
}

export function hours(ms: number): string {
  const h = ms / HOUR;
  if (h === 0) return '0h';
  if (h < 0.1) return `${Math.round(ms / 60000)}m`;
  return `${h.toFixed(1)}h`;
}
