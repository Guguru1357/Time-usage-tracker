import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/defaults';
import { MIN, assignLanes, clipToNow, dayStart, findGaps, fmtHMRel, periodsForDay, roundTo } from '../src/time';

const D = '2026-10-08';
const t = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return dayStart(D) + (h * 60 + m) * MIN;
};

describe('periodsForDay', () => {
  it('splits the day at reminder times', () => {
    const p = periodsForDay(D, DEFAULT_SETTINGS.reminders);
    expect(p.map((x) => x.reminder.id)).toEqual(['morning', 'afternoon', 'evening']);
    expect(p[0].range).toEqual({ start: t('00:00'), end: t('12:30') });
    expect(p[1].range).toEqual({ start: t('12:30'), end: t('18:00') });
    expect(p[2].range).toEqual({ start: t('18:00'), end: dayStart('2026-10-09') });
    expect(p[2].fireAt).toBe(t('22:30'));
  });

  it('sorts reminders by time', () => {
    const r = [...DEFAULT_SETTINGS.reminders].reverse();
    expect(periodsForDay(D, r).map((x) => x.reminder.id)).toEqual(['morning', 'afternoon', 'evening']);
  });
});

describe('findGaps', () => {
  it('returns uncovered parts and ignores tiny gaps', () => {
    const gaps = findGaps({ start: t('08:00'), end: t('12:00') }, [
      { start: t('07:00'), end: t('08:30') },
      { start: t('09:00'), end: t('10:00') },
      { start: t('09:30'), end: t('10:02') },
      { start: t('10:05'), end: t('11:00') },
    ]);
    expect(gaps).toEqual([
      { start: t('08:30'), end: t('09:00') },
      { start: t('11:00'), end: t('12:00') },
    ]);
  });

  it('whole range is a gap when nothing recorded', () => {
    expect(findGaps({ start: t('08:00'), end: t('09:00') }, [])).toEqual([{ start: t('08:00'), end: t('09:00') }]);
  });
});

describe('helpers', () => {
  it('clipToNow stops the range at now', () => {
    expect(clipToNow({ start: t('00:00'), end: t('12:30') }, t('10:07'))).toEqual({ start: t('00:00'), end: t('10:05') });
    expect(clipToNow({ start: t('12:30'), end: t('18:00') }, t('10:00')).end).toBe(t('12:30'));
  });

  it('roundTo aligns to local clock', () => {
    expect(roundTo(t('10:14'), 10, 'round')).toBe(t('10:10'));
    expect(roundTo(t('10:15'), 10, 'round')).toBe(t('10:20'));
    expect(roundTo(t('10:19'), 10, 'floor')).toBe(t('10:10'));
  });

  it('fmtHMRel marks next day', () => {
    expect(fmtHMRel(dayStart('2026-10-09'), D)).toBe('24:00');
    expect(fmtHMRel(dayStart('2026-10-09') + 60 * MIN, D)).toBe('隔天 01:00');
    expect(fmtHMRel(t('09:05'), D)).toBe('09:05');
  });

  it('assignLanes puts overlaps side by side', () => {
    const r = assignLanes([
      { start: 0, end: 10 },
      { start: 5, end: 15 },
      { start: 20, end: 30 },
    ]);
    expect(r.map((x) => [x.lane, x.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
  });
});
