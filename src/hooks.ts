import { useLiveQuery } from 'dexie-react-hooks';
import { useRef } from 'react';
import { db, type Activity, type Category, type Entry, type Settings } from './db';
import { DEFAULT_SETTINGS } from './defaults';
import { entriesOverlapping } from './repo';
import type { Interval } from './time';

export interface Catalog {
  categories: Category[];
  /** 未刪除的活動，依排序 */
  activities: Activity[];
  activityById: Map<string, Activity>;
  categoryById: Map<string, Category>;
}

export function useCatalog(): Catalog | undefined {
  return useLiveQuery(async () => {
    const [categories, all] = await Promise.all([
      db.categories.orderBy('order').toArray(),
      db.activities.orderBy('order').toArray(),
    ]);
    return {
      categories,
      activities: all.filter((a) => !a.archived),
      activityById: new Map(all.map((a) => [a.id, a])),
      categoryById: new Map(categories.map((c) => [c.id, c])),
    };
  });
}

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('main')) ?? DEFAULT_SETTINGS;
}

/** 切換日期時，新資料載入前先沿用上一份，避免畫面閃成「載入中」而跳回頂端 */
export function useEntries(range: Interval): Entry[] | undefined {
  const last = useRef<Entry[] | undefined>(undefined);
  const value = useLiveQuery(() => entriesOverlapping(range), [range.start, range.end]);
  if (value !== undefined) last.current = value;
  return value ?? last.current;
}
