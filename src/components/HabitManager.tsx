import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Habit } from '../db';
import { WEEKDAY_LABELS, archiveHabit, daysText, saveHabit } from '../habits';
import type { Catalog } from '../hooks';
import { useHabits } from '../hooks';
import { ActButton, ActivityPickerSheet } from './ActivityPicker';

/** 習慣清單：新增、編輯、刪除 */
export function HabitManager({ catalog, onClose }: { catalog: Catalog; onClose: () => void }) {
  const habits = useHabits() ?? [];
  const [editing, setEditing] = useState<Partial<Habit> | null>(null);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="管理習慣">
        <div className="sheet-body">
          <div className="sheet-title">管理習慣</div>
          <div className="manage-list">
            {habits.map((h) => (
              <button key={h.id} className="manage-row habit-manage-row" onClick={() => setEditing(h)}>
                <span className="habit-emoji">{h.emoji}</span>
                <span className="manage-main">
                  {h.name}
                  <small className="muted">
                    {daysText(h.days)}
                    {h.target > 1 ? ` · 每天 ${h.target} 次` : ''}
                    {h.activityId ? ` · 連動「${catalog.activityById.get(h.activityId)?.name ?? '?'}」` : ''}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <button className="add-row" onClick={() => setEditing({})}>
            ＋ 新增習慣
          </button>
          <p className="muted small">連動活動後，當天時間軸記了那個活動（或完成了連動的安排），習慣就會自動打勾。</p>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
      {editing && <HabitForm initial={editing} catalog={catalog} onClose={() => setEditing(null)} />}
    </div>,
    document.body,
  );
}

function HabitForm({ initial, catalog, onClose }: { initial: Partial<Habit>; catalog: Catalog; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [emoji, setEmoji] = useState(initial.emoji ?? '✅');
  const [days, setDays] = useState<number[]>(initial.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [target, setTarget] = useState(initial.target ?? 1);
  const [activityId, setActivityId] = useState<string | undefined>(initial.activityId);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState('');
  const activity = activityId ? catalog.activityById.get(activityId) : undefined;

  async function submit() {
    if (!name.trim()) return setError('請輸入名稱');
    if (!days.length) return setError('至少選一天');
    await saveHabit({ id: initial.id, name: name.trim(), emoji: [...emoji.trim()].slice(0, 2).join('') || '✅', days: [...days].sort(), target, activityId });
    onClose();
  }
  async function remove() {
    if (!initial.id || !confirm(`刪除習慣「${initial.name}」？過去的打勾紀錄會保留。`)) return;
    await archiveHabit(initial.id);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <div className="sheet-title">{initial.id ? '編輯習慣' : '新增習慣'}</div>
          <div className="habit-name-row">
            <label className="field">
              <span>圖示</span>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="emoji-input" />
            </label>
            <label className="field grow">
              <span>名稱</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：喝水、伸展" autoFocus={!initial.id} />
            </label>
          </div>
          <div className="field">
            <span>哪幾天</span>
            <div className="chips">
              {WEEKDAY_LABELS.map((l, d) => (
                <button
                  key={d}
                  className={`chip day-chip${days.includes(d) ? ' selected' : ''}`}
                  onClick={() => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="chips">
              <button className="chip" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>
                每天
              </button>
              <button className="chip" onClick={() => setDays([1, 2, 3, 4, 5])}>
                平日
              </button>
              <button className="chip" onClick={() => setDays([0, 6])}>
                週末
              </button>
            </div>
          </div>
          <div className="field">
            <span>每天目標次數</span>
            <div className="range-row">
              <button className="step-btn" onClick={() => setTarget(Math.max(1, target - 1))} aria-label="減少">
                −
              </button>
              <b className="count">{target}</b>
              <button className="step-btn" onClick={() => setTarget(target + 1)} aria-label="增加">
                ＋
              </button>
              <span className="muted small">次（例如喝水 8 杯）</span>
            </div>
          </div>
          <div className="field">
            <span>連動活動（選填）</span>
            {activity ? (
              <div className="selected-row">
                <ActButton name={activity.name} color={activity.color} selected onClick={() => setPicker(true)} />
                <button className="text-btn" onClick={() => setActivityId(undefined)}>
                  不連動
                </button>
              </div>
            ) : (
              <button className="add-row" onClick={() => setPicker(true)}>
                ＋ 選擇活動
              </button>
            )}
          </div>
          {error && <div className="error">{error}</div>}
        </div>
        {picker && <ActivityPickerSheet title="連動活動" catalog={catalog} onSelect={setActivityId} onClose={() => setPicker(false)} />}
        <div className="sheet-actions">
          {initial.id ? (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          )}
          <button className="btn primary" onClick={submit}>
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}
