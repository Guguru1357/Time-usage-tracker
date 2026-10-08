import { db, uid, type Activity, type Category, type Entry, type Settings } from './db';
import { DEFAULT_SETTINGS } from './defaults';
import { HOUR, type Interval } from './time';

/** 單筆紀錄最長 48 小時，查詢時往前多看這麼久 */
const MAX_ENTRY_SPAN = 48 * HOUR;

export async function entriesOverlapping(range: Interval): Promise<Entry[]> {
  const list = await db.entries
    .where('start')
    .between(range.start - MAX_ENTRY_SPAN, range.end, true, false)
    .filter((e) => e.end > range.start)
    .toArray();
  return list.sort((a, b) => a.start - b.start);
}

export async function saveEntry(
  data: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<Entry> {
  if (!(data.end > data.start)) throw new Error('結束時間必須晚於開始時間');
  if (data.end - data.start > MAX_ENTRY_SPAN) throw new Error('單筆紀錄不能超過 48 小時');
  const now = Date.now();
  const existing = data.id ? await db.entries.get(data.id) : undefined;
  const entry: Entry = {
    ...existing,
    ...data,
    id: data.id ?? uid(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.entries.put(entry);
  return entry;
}

export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id);
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('main')) ?? structuredClone(DEFAULT_SETTINGS);
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, id: 'main' });
}

// ---------- 分類 ----------

export async function saveCategory(c: Omit<Category, 'id' | 'order'> & { id?: string }): Promise<void> {
  if (c.id) {
    await db.categories.update(c.id, { name: c.name, color: c.color, highlight: c.highlight });
    return;
  }
  const count = await db.categories.count();
  await db.categories.add({ ...c, id: uid(), order: count });
}

/** 分類底下還有活動時不能刪除 */
export async function deleteCategory(id: string): Promise<void> {
  const used = await db.activities.where('categoryId').equals(id).filter((a) => !a.archived).count();
  if (used > 0) throw new Error('這個分類底下還有活動，請先把活動移到其他分類或刪除');
  // 已刪除的活動若仍參照此分類，舊紀錄之後會顯示為「未分類」
  await db.categories.delete(id);
  await normalizeOrder('categories');
}

// ---------- 活動 ----------

export async function saveActivity(a: Omit<Activity, 'id' | 'order'> & { id?: string }): Promise<void> {
  if (a.id) {
    const { id, ...rest } = a;
    await db.activities.update(id, rest);
    return;
  }
  const max = await db.activities.orderBy('order').last();
  await db.activities.add({ ...a, id: uid(), order: (max?.order ?? -1) + 1 });
}

/** 軟刪除：舊紀錄仍能顯示活動名稱 */
export async function archiveActivity(id: string): Promise<void> {
  await db.activities.update(id, { archived: true });
}

async function normalizeOrder(table: 'categories' | 'activities'): Promise<void> {
  const t = db[table];
  const all = await t.orderBy('order').toArray();
  await Promise.all(all.map((x, i) => (x.order === i ? null : t.update(x.id, { order: i }))));
}

/** 在同一群組中上下移動 */
export async function move(
  table: 'categories' | 'activities',
  id: string,
  dir: -1 | 1,
  sameGroup: (x: Category | Activity) => boolean = () => true,
): Promise<void> {
  const t = db[table] as typeof db.categories | typeof db.activities;
  await db.transaction('rw', t, async () => {
    const all = (await t.orderBy('order').toArray()) as (Category | Activity)[];
    const visible = all.filter((x) => !(x as Activity).archived && sameGroup(x));
    const idx = visible.findIndex((x) => x.id === id);
    const other = visible[idx + dir];
    if (idx === -1 || !other) return;
    const me = visible[idx];
    await t.update(me.id, { order: other.order });
    await t.update(other.id, { order: me.order });
  });
}
