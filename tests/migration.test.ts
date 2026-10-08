import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { TimeLedgerDB } from '../src/db';
import { defaultActivities } from '../src/defaults';

it('v1 → v2 marks 睡覺 as a long-duration activity', async () => {
  const old = new Dexie('migration-test');
  old.version(1).stores({ categories: 'id, order', activities: 'id, order, categoryId', entries: 'id, start, end, activityId', settings: 'id', kv: 'key' });
  await old.open();
  await old.table('activities').bulkAdd(defaultActivities().map(({ longDuration: _, ...a }) => a));
  old.close();

  const db = new TimeLedgerDB('migration-test');
  await db.open();
  const all = await db.activities.toArray();
  expect(all.find((a) => a.name === '睡覺')?.longDuration).toBe(true);
  expect(all.filter((a) => a.longDuration)).toHaveLength(1);
  db.close();
});
