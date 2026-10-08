import { useLiveQuery } from 'dexie-react-hooks';
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

export function useEntries(range: Interval): Entry[] | undefined {
  return useLiveQuery(() => entriesOverlapping(range), [range.start, range.end]);
}
