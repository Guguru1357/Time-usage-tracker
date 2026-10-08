import { useState } from 'react';
import { type EditorTarget, EntryEditor } from '../components/EntryEditor';
import { IconChevronLeft } from '../components/Icons';
import { entrySummary } from '../study';
import { useCatalog, useEntries, useSettings } from '../hooks';
import { entriesOverlapping } from '../repo';
import { MIN, clipToNow, findGaps, fmtDateLabel, fmtDuration, fmtHMRel, periodsForDay, todayKey } from '../time';

interface Props {
  dateKey: string;
  reminderId: string;
  onBack: () => void;
}

export function ReviewView({ dateKey, reminderId, onBack }: Props) {
  const catalog = useCatalog();
  const settings = useSettings();
  const period = periodsForDay(dateKey, settings.reminders).find((p) => p.reminder.id === reminderId);
  const range = period ? (dateKey === todayKey() ? clipToNow(period.range) : period.range) : { start: 0, end: 0 };
  const entries = useEntries(range);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  if (!period) {
    return (
      <div className="page">
        <p>找不到這個回顧時段。</p>
        <button className="btn" onClick={onBack}>
          返回
        </button>
      </div>
    );
  }
  if (!catalog || !entries) return <div className="loading">載入中…</div>;

  const gaps = findGaps(range, entries, 10 * MIN);
  const open = (t: EditorTarget) => {
    setEditor(t);
    setEditorKey((k) => k + 1);
  };
  const openNextGap = async () => {
    const fresh = findGaps(range, await entriesOverlapping(range), 10 * MIN);
    if (fresh.length === 0) return setEditor(null);
    open({ kind: 'new', start: fresh[0].start, end: fresh[0].end });
  };

  return (
    <div className="page">
      <header className="sub-header">
        <button className="icon-btn" onClick={onBack} aria-label="返回">
          <IconChevronLeft />
        </button>
        <div>
          <div className="sub-title">
            回顧{period.reminder.periodLabel} · {fmtDateLabel(dateKey)}
          </div>
          <div className="muted">
            {fmtHMRel(period.range.start, dateKey)}–{fmtHMRel(period.range.end, dateKey)}
          </div>
        </div>
      </header>

      <section>
        <h3>未記錄的時段</h3>
        {gaps.length === 0 ? (
          <div className="all-done">這個時段都記完了 🎉</div>
        ) : (
          <div className="gap-list">
            {gaps.map((g) => (
              <button key={g.start} className="gap-card" onClick={() => open({ kind: 'new', start: g.start, end: g.end })}>
                <span className="gap-time">
                  {fmtHMRel(g.start, dateKey)} – {fmtHMRel(g.end, dateKey)}
                </span>
                <span className="muted">{fmtDuration(g.end - g.start)}</span>
                <span className="gap-plus">補記</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>已記錄</h3>
        {entries.length === 0 && <div className="muted">還沒有紀錄</div>}
        <div className="entry-list">
          {entries.map((e) => {
            const a = catalog.activityById.get(e.activityId);
            const cat = a && catalog.categoryById.get(a.categoryId);
            return (
              <button key={e.id} className="entry-row" onClick={() => open({ kind: 'edit', entry: e })}>
                <span className="color-bar" style={{ background: a?.color ?? '#94a3b8' }} />
                <span className="entry-time">
                  {fmtHMRel(e.start, dateKey)}–{fmtHMRel(e.end, dateKey)}
                </span>
                <span className={`entry-name${cat?.highlight ? ' sns-text' : ''}`}>
                  {a?.name ?? '（已刪除）'}
                  {(() => {
                    const s = entrySummary(e, (id) => catalog.activityById.get(id)?.name);
                    return s && <small> · {s}</small>;
                  })()}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {editor && (
        <EntryEditor
          key={editorKey}
          target={editor}
          catalog={catalog}
          step={settings.step}
          onClose={() => setEditor(null)}
          onSavedNext={() => void openNextGap()}
        />
      )}
    </div>
  );
}
