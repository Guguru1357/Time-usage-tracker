import { useState } from 'react';
import { type EditorTarget, EntryEditor } from '../components/EntryEditor';
import { IconChevronLeft, IconChevronRight, IconPlus } from '../components/Icons';
import { Timeline } from '../components/Timeline';
import { useCatalog, useEntries, useSettings } from '../hooks';
import {
  MIN,
  addDays,
  clipToNow,
  dayEnd,
  dayStart,
  findGaps,
  fmtDateLabel,
  fmtHours,
  periodsForDay,
  roundTo,
  todayKey,
} from '../time';
import { entriesOverlapping } from '../repo';

interface Props {
  dateKey: string;
  onDate: (d: string) => void;
  onReview: (reminderId: string) => void;
}

export function DayView({ dateKey, onDate, onReview }: Props) {
  const catalog = useCatalog();
  const settings = useSettings();
  const range = { start: dayStart(dateKey), end: dayEnd(dateKey) };
  const entries = useEntries(range);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  if (!catalog || !entries) return <div className="loading">載入中…</div>;

  const now = Date.now();
  const isToday = dateKey === todayKey();
  const isFuture = range.start > now;
  const clipped = entries.map((e) => ({ e, start: Math.max(e.start, range.start), end: Math.min(e.end, range.end) }));

  let recorded = 0;
  let highlighted = 0;
  for (const c of clipped) {
    const ms = c.end - c.start;
    recorded += ms;
    const a = catalog.activityById.get(c.e.activityId);
    if (a && catalog.categoryById.get(a.categoryId)?.highlight) highlighted += ms;
  }
  const elapsed = isFuture ? 0 : (isToday ? clipToNow(range, now) : range).end - range.start;
  const gapMs = findGaps(isToday ? clipToNow(range, now) : range, clipped, MIN).reduce((s, g) => s + g.end - g.start, 0);
  const highlightName = catalog.categories.find((c) => c.highlight)?.name ?? 'SNS';

  const periods = periodsForDay(dateKey, settings.reminders);

  const open = (t: EditorTarget) => {
    setEditor(t);
    setEditorKey((k) => k + 1);
  };

  const openNew = () => {
    // 從最後一筆的結束時間接著記；沒有的話從現在往前一個刻度
    const lastEnd = clipped.filter((c) => c.end <= now).reduce((m, c) => Math.max(m, c.end), 0);
    const start = lastEnd || (isToday ? roundTo(now - 60 * MIN, settings.step, 'floor') : range.start + 8 * 60 * MIN);
    const end = isToday && now > start ? Math.max(roundTo(now, settings.step, 'round'), start + settings.step * MIN) : start + 60 * MIN;
    open({ kind: 'new', start, end });
  };

  const nextGap = async () => {
    const list = await entriesOverlapping(range);
    const gaps = findGaps(isToday ? clipToNow(range, Date.now()) : range, list, 10 * MIN);
    if (gaps.length === 0) return setEditor(null);
    open({ kind: 'new', start: gaps[0].start, end: gaps[0].end });
  };

  return (
    <div className="page">
      <header className="day-header">
        <label className="date-pick">
          <span className="date-title">{fmtDateLabel(dateKey)}</span>
          <span className="date-sub">{isToday ? '今天' : '點此選擇日期'}</span>
          <input type="date" value={dateKey} onChange={(e) => e.target.value && onDate(e.target.value)} />
        </label>
        <div className="day-nav">
          {!isToday && (
            <button className="text-btn" onClick={() => onDate(todayKey())}>
              今天
            </button>
          )}
          <button className="icon-btn" onClick={() => onDate(addDays(dateKey, -1))} aria-label="前一天">
            <IconChevronLeft />
          </button>
          <button className="icon-btn" onClick={() => onDate(addDays(dateKey, 1))} aria-label="後一天">
            <IconChevronRight />
          </button>
        </div>
      </header>

      <div className="summary">
        <div>
          <span>已記錄</span>
          <b>{fmtHours(recorded)}</b>
        </div>
        <div>
          <span>未記錄</span>
          <b>
            {fmtHours(gapMs)}
            {elapsed > 0 && <small> / {fmtHours(elapsed)}</small>}
          </b>
        </div>
        <div className={highlighted > 0 ? 'sns-hot' : ''}>
          <span>{highlightName}</span>
          <b>{fmtHours(highlighted)}</b>
        </div>
      </div>

      {!isFuture && (
        <div className="period-chips">
          {periods.map((p) => {
            if (p.range.start > now) return null;
            const r = isToday ? clipToNow(p.range, now) : p.range;
            const n = findGaps(r, clipped, 10 * MIN).length;
            return (
              <button key={p.reminder.id} className={`period-chip${n === 0 ? ' done' : ''}`} onClick={() => onReview(p.reminder.id)}>
                <span>{p.reminder.periodLabel}</span>
                <small>{n === 0 ? '已完成' : `${n} 段空白`}</small>
              </button>
            );
          })}
        </div>
      )}

      <Timeline
        dateKey={dateKey}
        entries={entries}
        catalog={catalog}
        onEntry={(e) => open({ kind: 'edit', entry: e })}
        onGap={(g) => open({ kind: 'new', start: g.start, end: g.end })}
      />

      <button className="fab" onClick={openNew} aria-label="新增紀錄">
        <IconPlus size={26} />
      </button>

      {editor && (
        <EntryEditor
          key={editorKey}
          target={editor}
          catalog={catalog}
          step={settings.step}
          onClose={() => setEditor(null)}
          onSavedNext={() => void nextGap()}
        />
      )}
    </div>
  );
}
