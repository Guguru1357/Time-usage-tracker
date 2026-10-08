import { useEffect, useRef } from 'react';
import type { Entry } from '../db';
import type { Catalog } from '../hooks';
import { entrySummary } from '../study';
import { MIN, assignLanes, clipToNow, dayEnd, dayStart, findGaps, fmtDuration, fmtHM, type Interval } from '../time';

const PX_PER_MIN = 1.1;
/** 只在打開 App 時捲到現在時間；之後切換日期維持原本的捲動位置 */
let didInitialScroll = false;

interface Props {
  dateKey: string;
  entries: Entry[];
  catalog: Catalog;
  onEntry: (e: Entry) => void;
  onGap: (g: Interval) => void;
}

export function Timeline({ dateKey, entries, catalog, onEntry, onGap }: Props) {
  const start = dayStart(dateKey);
  const end = dayEnd(dateKey);
  const now = Date.now();
  const isToday = now >= start && now < end;
  const scrollTarget = useRef<HTMLDivElement>(null);

  const clipped = entries
    .map((e) => ({ entry: e, start: Math.max(e.start, start), end: Math.min(e.end, end) }))
    .filter((x) => x.end > x.start);
  const laid = assignLanes(clipped);
  const gapRange = isToday ? clipToNow({ start, end }, now) : { start, end };
  const gaps = start > now ? [] : findGaps(gapRange, clipped, 10 * MIN);

  const summary = (e: Entry) => entrySummary(e, (id) => catalog.activityById.get(id)?.name);
  const y = (ms: number) => ((ms - start) / MIN) * PX_PER_MIN;

  // 打開時捲到「現在」附近，不是今天就捲到第一個空白或早上
  const focusAt = isToday ? now - 2 * 60 * MIN : (gaps.find((g) => g.start >= start + 6 * 60 * MIN)?.start ?? start + 7 * 60 * MIN);
  useEffect(() => {
    if (didInitialScroll) return;
    didInitialScroll = true;
    scrollTarget.current?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <div className="timeline" style={{ height: 24 * 60 * PX_PER_MIN }}>
      <div className="tl-scroll-target" ref={scrollTarget} style={{ top: Math.max(0, y(focusAt)) - 80 }} />
      {Array.from({ length: 25 }, (_, h) => (
        <div key={h} className="tl-hour" style={{ top: h * 60 * PX_PER_MIN }}>
          <span>{String(h).padStart(2, '0')}:00</span>
        </div>
      ))}
      <div className="tl-track">
        {gaps.map((g) => (
          <button
            key={g.start}
            className="tl-gap"
            style={{ top: y(g.start), height: Math.max(y(g.end) - y(g.start), 14) }}
            onClick={() => onGap(g)}
          >
            {y(g.end) - y(g.start) >= 22 && (
              <span>
                ＋ {fmtHM(g.start)}–{g.end === end ? '24:00' : fmtHM(g.end)} 未記錄 · {fmtDuration(g.end - g.start)}
              </span>
            )}
          </button>
        ))}
        {laid.map(({ item, lane, lanes }) => {
          const a = catalog.activityById.get(item.entry.activityId);
          const cat = a && catalog.categoryById.get(a.categoryId);
          const h = y(item.end) - y(item.start);
          return (
            <button
              key={item.entry.id}
              className={`tl-entry${cat?.highlight ? ' highlight' : ''}`}
              style={{
                top: y(item.start),
                height: Math.max(h, 10),
                left: `${(lane / lanes) * 100}%`,
                width: `calc(${100 / lanes}% - 2px)`,
                ['--c' as string]: a?.color ?? '#94a3b8',
              }}
              onClick={() => onEntry(item.entry)}
            >
              {h >= 16 && (
                <span className="tl-entry-label">
                  {a?.name ?? '（已刪除）'}
                  {h >= 34 && (
                    <small>
                      {fmtHM(item.entry.start)}–{fmtHM(item.entry.end)}
                      {summary(item.entry) && ` · ${summary(item.entry)}`}
                    </small>
                  )}
                </span>
              )}
            </button>
          );
        })}
        {isToday && <div className="tl-now" style={{ top: y(now) }} />}
      </div>
    </div>
  );
}
