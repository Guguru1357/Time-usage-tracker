import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, restoreBackup } from '../src/backup';
import { TimeLedgerDB, db, type Habit, type HabitLog } from '../src/db';
import { defaultActivities, ensureSeeded } from '../src/defaults';
import { activitiesByDate, bumpHabit, habitDay, streak } from '../src/habits';
import { plansToNotify } from '../src/notifications';
import { completePlan, copyPlans, plansForDate, resultText, savePlan, targetText, uncompletePlan } from '../src/plans';
import { HOUR, MIN, dayStart } from '../src/time';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

const reading = () => defaultActivities().find((a) => a.name === '閱讀')!;
const gym = () => defaultActivities().find((a) => a.name === '重訓')!;

describe('seed', () => {
  it('adds default habits linked to activities, and marks 重訓 as workout', async () => {
    const habits = await db.habits.orderBy('order').toArray();
    expect(habits.map((h) => h.name)).toEqual(['重訓', '彈鋼琴', '讀日文', '保健食品', '家務']);
    expect(habits[0].activityId).toBe(gym().id);
    expect((await db.activities.get(gym().id))?.workout).toBe(true);
  });
});

describe('plans', () => {
  it('completing a reading plan logs a timeline entry with the book and pages', async () => {
    const plan = await savePlan({
      date: '2026-11-11',
      time: '22:00',
      durationMin: 45,
      title: '閱讀',
      activityId: reading().id,
      remind: true,
      study: { title: '原子習慣', pageFrom: 30, pageTo: 60 },
    });
    expect(targetText(plan)).toBe('《原子習慣》 p.30–60');
    const done = await completePlan(plan, {
      result: { study: { title: '原子習慣', pageFrom: 30, pageTo: 52 } },
      logEntry: true,
      activity: reading(),
    });
    const entry = await db.entries.get(done.entryId!);
    expect(entry?.start).toBe(dayStart('2026-11-11') + 22 * HOUR);
    expect(entry?.end).toBe(entry!.start + 45 * MIN);
    expect(entry?.details).toEqual({ title: '原子習慣', progress: 'p.30–52' });
    expect(resultText(done.result)).toBe('《原子習慣》 p.30–52');

    const undone = await uncompletePlan(done);
    expect(undone.doneAt).toBeUndefined();
    expect(await db.entries.get(done.entryId!)).toBeUndefined();
  });

  it('completing a workout keeps the sets and writes them to the entry note', async () => {
    const plan = await savePlan({ date: '2026-11-10', time: '18:00', title: '健身課', activityId: gym().id, remind: true, muscles: ['胸', '三頭'], targetSets: 12 });
    const done = await completePlan(plan, {
      result: { workout: [{ exercise: '臥推', weight: 60, reps: 8, sets: 4 }, { exercise: '  ' }] },
      logEntry: true,
      activity: gym(),
    });
    expect(done.result?.workout).toEqual([{ exercise: '臥推', weight: 60, reps: 8, sets: 4 }]);
    expect((await db.entries.get(done.entryId!))?.note).toBe('臥推 60kg × 8下 × 4組');
  });

  it('copies plans to another day without completion state', async () => {
    const p = await savePlan({ date: '2026-11-10', time: '16:30', title: '練前餐', remind: true });
    await completePlan(p, { logEntry: false });
    await savePlan({ date: '2026-11-10', time: '19:15', title: '練後餐', remind: true });
    expect(await copyPlans('2026-11-10', '2026-11-17')).toBe(2);
    const copied = await plansForDate('2026-11-17');
    expect(copied.map((x) => x.time)).toEqual(['16:30', '19:15']);
    expect(copied.every((x) => !x.doneAt)).toBe(true);
  });

  it('only notifies plans that are pending, have reminders on and are still ahead', async () => {
    const base = dayStart('2026-11-10');
    const mk = (time: string, extra = {}) => ({ id: time, date: '2026-11-10', time, title: time, remind: true, createdAt: 0, updatedAt: 0, ...extra });
    const list = [mk('16:30'), mk('18:00', { doneAt: 1 }), mk('19:15', { remind: false }), mk('20:00')];
    const out = plansToNotify(list, 10, base + 17 * HOUR);
    expect(out.map((x) => x.plan.id)).toEqual(['20:00']);
    expect(out[0].at).toBe(base + 20 * HOUR - 10 * MIN);
  });
});

describe('habits', () => {
  const habit: Habit = { id: 'h', name: '鋼琴', emoji: '🎹', days: [0, 1, 2, 3, 4, 5, 6], target: 1, order: 0, activityId: 'piano' };

  it('counts a timeline entry of the linked activity as done, and keeps the streak through today', async () => {
    await bumpHabit('h', '2026-11-07', 1);
    await bumpHabit('h', '2026-11-08', 1);
    const logs = new Map((await db.habitLogs.toArray()).map((l: HabitLog) => [l.id, l]));
    const acts = activitiesByDate([{ id: 'e', start: dayStart('2026-11-09') + HOUR, end: dayStart('2026-11-09') + 2 * HOUR, activityId: 'piano', createdAt: 0, updatedAt: 0 }]);
    expect(habitDay(habit, '2026-11-09', logs, acts)).toEqual({ count: 0, fromTimeline: true, done: true });
    expect(streak(habit, '2026-11-09', logs, acts)).toBe(3);
    // 今天還沒做不算中斷
    expect(streak(habit, '2026-11-10', logs, acts)).toBe(3);
  });

  it('skips days the habit is not scheduled on', async () => {
    const mwf: Habit = { ...habit, activityId: undefined, days: [1, 3, 5] };
    // 2026-11-02 一、11-04 三、11-06 五
    for (const d of ['2026-11-02', '2026-11-04', '2026-11-06']) await bumpHabit('h', d, 1);
    const logs = new Map((await db.habitLogs.toArray()).map((l: HabitLog) => [l.id, l]));
    expect(streak(mwf, '2026-11-08', logs, new Map())).toBe(3);
  });

  it('removes the log when the count goes back to zero', async () => {
    expect(await bumpHabit('h', '2026-11-09', 1)).toBe(1);
    expect(await bumpHabit('h', '2026-11-09', -1)).toBe(0);
    expect(await db.habitLogs.count()).toBe(0);
  });
});

describe('backup', () => {
  it('round-trips plans and habits, and keeps them when restoring an old backup', async () => {
    await savePlan({ date: '2026-11-10', time: '20:00', title: '練琴', remind: true });
    await bumpHabit('habit-2', '2026-11-10', 1);
    const backup = await buildBackup();
    expect(backup.plans).toHaveLength(1);
    expect(backup.habits).toHaveLength(5);

    const { plans: _p, habits: _h, habitLogs: _l, ...old } = backup;
    await restoreBackup(old);
    expect(await db.plans.count()).toBe(1);

    await restoreBackup({ ...backup, plans: [] });
    expect(await db.plans.count()).toBe(0);
    expect(await db.habitLogs.count()).toBe(1);
  });
});

it('v2 → v3 marks 重訓 as workout and adds default habits', async () => {
  const old = new Dexie('migration-v3');
  old.version(2).stores({ categories: 'id, order', activities: 'id, order, categoryId', entries: 'id, start, end, activityId', settings: 'id', kv: 'key' });
  await old.open();
  await old.table('activities').bulkAdd(defaultActivities().map(({ workout: _, ...a }) => a));
  old.close();

  const next = new TimeLedgerDB('migration-v3');
  await next.open();
  expect((await next.activities.toArray()).filter((a) => a.workout).map((a) => a.name)).toEqual(['重訓']);
  const habits = await next.habits.toArray();
  expect(habits).toHaveLength(5);
  expect(habits.find((h) => h.name === '彈鋼琴')?.activityId).toBe(defaultActivities().find((a) => a.name === '彈鋼琴')!.id);
  next.close();
});
