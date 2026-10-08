import { expect, it } from 'vitest';
import type { Entry } from '../src/db';
import { defaultActivities, defaultCategories } from '../src/defaults';
import { computeStats, dailyHighlight, shiftWeek, weekRange, weekStartKey } from '../src/stats';
import { HOUR, MIN, dayStart } from '../src/time';

const acts = defaultActivities();
const cats = defaultCategories();
const catalog = { activityById: new Map(acts.map((a) => [a.id, a])), categoryById: new Map(cats.map((c) => [c.id, c])) };
const id = (name: string) => acts.find((a) => a.name.startsWith(name))!.id;
const base = dayStart('2026-10-08'); // 週四
let n = 0;
const entry = (activity: string, from: number, to: number, extra: Partial<Entry> = {}): Entry => ({
  id: `e${n++}`,
  activityId: id(activity),
  start: base + from * HOUR,
  end: base + to * HOUR,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

it('weeks start on Monday', () => {
  expect(weekStartKey('2026-10-08')).toBe('2026-10-05');
  expect(weekStartKey('2026-10-11')).toBe('2026-10-05');
  expect(weekStartKey('2026-10-12')).toBe('2026-10-12');
  const w = weekRange('2026-10-08');
  expect(w.end - w.start).toBe(7 * 24 * HOUR);
  expect(shiftWeek(w, -1)).toEqual(weekRange('2026-09-29'));
});

it('aggregates by activity/category, counts SNS incl. secondary, without double counting', () => {
  const entries = [
    entry('交通', 8, 9, { secondary: [{ activityId: id('瀏覽 SNS') }] }),
    entry('瀏覽 SNS', 8.5, 10),
    entry('讀日文', 10, 11, { details: { title: '大家的日本語', grammar: ['〜てしまう'], vocab: ['猫', '犬'] } }),
    entry('讀日文', 20, 20.5, { details: { title: '大家的日本語', vocab: ['猫', '鳥'] } }),
    entry('交通', 21, 22, { secondary: [{ activityId: id('閱讀'), study: { title: '挪威的森林', progress: 'p.1–30' } }] }),
  ];
  const s = computeStats(entries, { start: base, end: base + 24 * HOUR }, catalog);
  expect(s.recorded).toBe(4.5 * HOUR);
  expect(s.highlight).toBe(2 * HOUR); // 8:00–10:00 union
  expect(s.byCategory.find((c) => c.id === 'cat-sns')?.ms).toBe(1.5 * HOUR);
  expect(s.byActivity[0]).toEqual({ id: id('交通'), ms: 2 * HOUR });
  const jp = s.study.find((g) => g.activityId === id('讀日文'))!;
  expect(jp.ms).toBe(1.5 * HOUR);
  expect(jp.vocab).toEqual(['猫', '犬', '鳥']);
  expect(jp.titles).toEqual([{ title: '大家的日本語', ms: 1.5 * HOUR, progress: [] }]);
  const book = s.study.find((g) => g.activityId === id('閱讀'))!;
  expect(book.titles[0]).toMatchObject({ title: '挪威的森林', progress: ['p.1–30'] });
  expect(s.secondaryByActivity.map((x) => x.id)).toEqual([id('瀏覽 SNS'), id('閱讀')]);
});

it('stops counting at `until`', () => {
  const entries = [entry('瀏覽 SNS', 9, 12)];
  const s = computeStats(entries, { start: base, end: base + 24 * HOUR }, catalog, base + 10 * HOUR + 30 * MIN);
  expect(s.highlight).toBe(1.5 * HOUR);
  expect(s.elapsed).toBe(10.5 * HOUR);
  const daily = dailyHighlight(entries, '2026-10-05', catalog);
  expect(daily[3]).toBe(3 * HOUR);
  expect(daily.filter(Boolean)).toHaveLength(1);
});

import { cleanNotes, parseBuild } from '../src/updater';
it('parses release metadata', () => {
  expect(parseBuild('最新 APK（#12）', '<!-- build:13 sha:abc -->\n- x')).toBe(13);
  expect(parseBuild('最新 APK（#12）', 'no marker')).toBe(12);
  expect(cleanNotes('<!-- build:13 -->\n- 新功能\n\n\n<!-- foot -->')).toBe('- 新功能');
});
