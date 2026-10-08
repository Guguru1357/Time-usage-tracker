import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, buildCsv, parseBackup, restoreBackup } from '../src/backup';
import { db } from '../src/db';
import { ensureSeeded } from '../src/defaults';
import { deleteCategory, entriesOverlapping, move, saveCategory, saveEntry } from '../src/repo';
import { HOUR, dayStart } from '../src/time';

const base = dayStart('2026-10-08');

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

describe('seed', () => {
  it('creates categories, activities and settings once', async () => {
    await ensureSeeded();
    expect(await db.categories.count()).toBe(5);
    expect(await db.activities.count()).toBe(19);
    const s = await db.settings.get('main');
    expect(s?.step).toBe(10);
    expect(s?.reminders.map((r) => r.time)).toEqual(['12:30', '18:00', '22:30']);
    expect((await db.categories.get('cat-sns'))?.highlight).toBe(true);
  });
});

describe('entries', () => {
  it('finds entries crossing midnight', async () => {
    await saveEntry({ start: base - 1 * HOUR, end: base + 7 * HOUR, activityId: 'act-9' });
    await saveEntry({ start: base + 8 * HOUR, end: base + 9 * HOUR, activityId: 'act-1' });
    const list = await entriesOverlapping({ start: base, end: base + 24 * HOUR });
    expect(list).toHaveLength(2);
    const prev = await entriesOverlapping({ start: base - 24 * HOUR, end: base });
    expect(prev).toHaveLength(1);
  });

  it('rejects end before start', async () => {
    await expect(saveEntry({ start: base + HOUR, end: base, activityId: 'act-1' })).rejects.toThrow();
  });
});

describe('categories', () => {
  it('cannot delete a category that still has activities', async () => {
    await expect(deleteCategory('cat-sns')).rejects.toThrow();
    await saveCategory({ name: '冥想', color: '#000000', highlight: false });
    const added = (await db.categories.toArray()).find((c) => c.name === '冥想')!;
    expect(added.order).toBe(5);
    await deleteCategory(added.id);
    expect(await db.categories.count()).toBe(5);
  });

  it('moves categories and activities within a group', async () => {
    await move('categories', 'cat-sns', -1);
    const order = (await db.categories.orderBy('order').toArray()).map((c) => c.id);
    expect(order.slice(-2)).toEqual(['cat-sns', 'cat-fun']);

    const sport = async () =>
      (await db.activities.orderBy('order').toArray()).filter((a) => a.categoryId === 'cat-sport').map((a) => a.name);
    expect(await sport()).toEqual(['重訓', '打籃球']);
    await move('activities', 'act-8', -1, (x) => (x as { categoryId: string }).categoryId === 'cat-sport');
    expect(await sport()).toEqual(['打籃球', '重訓']);
  });
});

describe('backup', () => {
  it('round-trips through JSON and produces CSV', async () => {
    await saveEntry({ start: base + 8 * HOUR, end: base + 9 * HOUR, activityId: 'act-1', note: '寫 "app", 很順' });
    const json = JSON.stringify(await buildBackup());
    const csv = await buildCsv();
    expect(csv).toContain('"寫 ""app"", 很順"');
    await db.entries.clear();
    await restoreBackup(parseBackup(json));
    expect(await db.entries.count()).toBe(1);
    expect(() => parseBackup('{"foo":1}')).toThrow();
  });
});
