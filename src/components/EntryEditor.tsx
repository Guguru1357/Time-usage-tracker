import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, type Entry } from '../db';
import type { Catalog } from '../hooks';
import { deleteEntry, entriesOverlapping, saveEntry } from '../repo';
import { MIN, dayStart, fmtDateLabel, fmtDuration, fmtHM, roundTo, toDateKey } from '../time';
import { rescheduleReminders } from '../notifications';
import { TimeField } from './TimeField';
import { ActivityForm } from '../views/ManageView';

export type EditorTarget = { kind: 'new'; start: number; end: number } | { kind: 'edit'; entry: Entry };

interface Props {
  target: EditorTarget;
  catalog: Catalog;
  step: number;
  onClose: () => void;
  /** 有提供時顯示「儲存並記下一段」 */
  onSavedNext?: (saved: Entry) => void;
}

const DAY_MIN = 24 * 60;
const SHORT_CHIPS = [10, 30, 60, 90, 120];
const LONG_CHIPS = [300, 360, 420, 480, 540, 600];

function minToHM(m: number): string {
  const x = ((m % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

export function EntryEditor({ target, catalog, step, onClose, onSavedNext }: Props) {
  const initial = target.kind === 'edit' ? target.entry : null;
  const startMs = target.kind === 'edit' ? target.entry.start : target.start;
  const endMs = target.kind === 'edit' ? target.entry.end : target.end;
  const base = dayStart(toDateKey(startMs));

  // 以「開始日 00:00 起算的分鐘」編輯，結束可以超過 1440（跨到隔天）
  const [startMin, setStartMin] = useState(Math.round((startMs - base) / MIN));
  const [endMin, setEndMin] = useState(Math.round((endMs - base) / MIN));
  const [activityId, setActivityId] = useState<string | undefined>(initial?.activityId);
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  /** 正在新增活動的分類 id */
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const start = base + startMin * MIN;
  const end = base + endMin * MIN;

  const recent = useLiveQuery(async () => {
    const last = await db.entries.orderBy('start').reverse().limit(60).toArray();
    const ids: string[] = [];
    for (const e of last) if (!ids.includes(e.activityId)) ids.push(e.activityId);
    return ids;
  });
  const recentActs = (recent ?? [])
    .map((id) => catalog.activityById.get(id))
    .filter((a) => a && !a.archived)
    .slice(0, 6);

  const [overlaps, setOverlaps] = useState<Entry[]>([]);
  useEffect(() => {
    if (end <= start) return setOverlaps([]);
    let alive = true;
    void entriesOverlapping({ start, end }).then((list) => {
      if (alive) setOverlaps(list.filter((e) => e.id !== initial?.id && e.start < end && e.end > start));
    });
    return () => {
      alive = false;
    };
  }, [start, end, initial?.id]);

  const grouped = useMemo(
    () =>
      catalog.categories
        .map((c) => ({ cat: c, acts: catalog.activities.filter((a) => a.categoryId === c.id) }))
        .concat([
          {
            cat: { id: '', name: '未分類', color: '#94a3b8', highlight: false, order: 999 },
            acts: catalog.activities.filter((a) => !catalog.categoryById.has(a.categoryId)),
          },
        ])
        .filter((g) => g.cat.id || g.acts.length > 0),
    [catalog],
  );

  const setStart = (m: number) => {
    const clamped = Math.max(0, Math.min(DAY_MIN - step, m));
    setStartMin(clamped);
    if (endMin <= clamped) setEndMin(clamped + step);
  };
  const setEnd = (m: number) => {
    let v = m;
    if (v <= startMin) v += DAY_MIN; // 早於開始 → 視為隔天
    if (v - startMin > DAY_MIN) v -= DAY_MIN;
    setEndMin(v);
  };

  const selected = activityId ? catalog.activityById.get(activityId) : undefined;
  const now = Date.now();
  const nowMin = Math.round((roundTo(now, step, 'round') - base) / MIN);

  async function save(next: boolean) {
    if (!activityId) return setError('請選擇活動');
    if (end <= start) return setError('結束時間必須晚於開始時間');
    setSaving(true);
    try {
      const saved = await saveEntry({
        ...(initial ?? {}),
        id: initial?.id,
        start,
        end,
        activityId,
        note: note.trim() || undefined,
      });
      void rescheduleReminders();
      if (next && onSavedNext) onSavedNext(saved);
      else onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!initial) return;
    if (!confirm('確定刪除這筆紀錄？')) return;
    await deleteEntry(initial.id);
    void rescheduleReminders();
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="編輯紀錄">
        <div className="sheet-body">
          <div className="sheet-title">
            {initial ? '編輯紀錄' : '新增紀錄'} · {fmtDateLabel(toDateKey(base))}
          </div>

          <div className="time-rows">
            <TimeRow label="開始" value={minToHM(startMin)} onStep={(d) => setStart(startMin + d * step)} onInput={(v) => setStart(v)} />
            <TimeRow
              label="結束"
              value={minToHM(endMin)}
              suffix={endMin >= DAY_MIN ? '隔天' : undefined}
              onStep={(d) => setEnd(Math.max(startMin + step, endMin + d * step))}
              onInput={(v) => setEnd(v)}
            />
          </div>
          <div className="chips">
            <span className="muted">長度 {end > start ? fmtDuration(end - start) : '—'}</span>
            {(selected?.longDuration ? LONG_CHIPS : SHORT_CHIPS).map((d) => (
              <button key={d} className="chip" onClick={() => setEndMin(startMin + d)}>
                {d < 60 ? `${d}分` : `${d / 60}h`}
              </button>
            ))}
            {nowMin > startMin && nowMin - startMin <= DAY_MIN && (
              <button className="chip" onClick={() => setEndMin(nowMin)}>
                到現在
              </button>
            )}
          </div>

          {overlaps.length > 0 && (
            <div className="warn">
              ⚠ 與{' '}
              {overlaps
                .map((o) => `${catalog.activityById.get(o.activityId)?.name ?? '?'} ${fmtHM(o.start)}–${fmtHM(o.end)}`)
                .join('、')}{' '}
              重疊
            </div>
          )}

          {recentActs.length > 0 && (
            <>
              <div className="group-label">最近使用</div>
              <div className="act-grid">
                {recentActs.map((a) => (
                  <ActButton key={a!.id} name={a!.name} color={a!.color} selected={activityId === a!.id} onClick={() => setActivityId(a!.id)} />
                ))}
              </div>
            </>
          )}
          {grouped.map(({ cat, acts }) => (
            <div key={cat.id || 'none'}>
              <div className="group-label">
                <span className={cat.highlight ? 'sns-text' : ''}>{cat.name}</span>
                {cat.id && (
                  <button className="group-add" onClick={() => setAddingTo(cat.id)}>
                    ＋ 新增
                  </button>
                )}
              </div>
              <div className="act-grid">
                {acts.map((a) => (
                  <ActButton key={a.id} name={a.name} color={a.color} selected={activityId === a.id} onClick={() => setActivityId(a.id)} />
                ))}
              </div>
            </div>
          ))}

          <label className="field">
            <span>備註（選填）</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：和誰、在哪裡" />
          </label>
          {error && <div className="error">{error}</div>}
        </div>
        {addingTo !== null && (
          <ActivityForm
            initial={{ categoryId: addingTo, color: catalog.categoryById.get(addingTo)?.color }}
            categories={catalog.categories}
            onClose={() => setAddingTo(null)}
            onSaved={(id) => setActivityId(id)}
          />
        )}

        <div className="sheet-actions">
          {initial ? (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          )}
          {onSavedNext && (
            <button className="btn secondary" disabled={saving} onClick={() => save(true)}>
              存＋下一段
            </button>
          )}
          <button className="btn primary" disabled={saving} onClick={() => save(false)}>
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}

function TimeRow(props: { label: string; value: string; suffix?: string; onStep: (d: -1 | 1) => void; onInput: (min: number) => void }) {
  return (
    <div className="time-row">
      <span className="time-label">{props.label}</span>
      <button className="step-btn" onClick={() => props.onStep(-1)} aria-label={`${props.label}提前`}>
        −
      </button>
      <TimeField
        value={props.value}
        onChange={(v) => {
          const [h, m] = v.split(':').map(Number);
          props.onInput(h * 60 + m);
        }}
      />
      <button className="step-btn" onClick={() => props.onStep(1)} aria-label={`${props.label}延後`}>
        ＋
      </button>
      {props.suffix && <span className="badge">{props.suffix}</span>}
    </div>
  );
}

function ActButton(props: { name: string; color: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      className={`act-btn${props.selected ? ' selected' : ''}`}
      style={{ ['--c' as string]: props.color }}
      onClick={props.onClick}
    >
      <span className="dot" />
      {props.name}
    </button>
  );
}
