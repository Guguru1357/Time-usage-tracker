import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Plan, PlanStudy, WorkoutSet } from '../db';
import type { Catalog } from '../hooks';
import { rescheduleReminders } from '../notifications';
import { DEFAULT_PLAN_MIN, completePlan, lastWorkout, planStart, recentExercises, targetText } from '../plans';
import { STUDY_FIELDS } from '../study';
import { MIN, fmtHM } from '../time';
import { usesPages } from './PlanEditor';

interface Props {
  plan: Plan;
  catalog: Catalog;
  onClose: () => void;
  onDone: (msg: string) => void;
}

const emptySet = (): WorkoutSet => ({ exercise: '' });

/** 有細節的安排（閱讀、重訓）完成時填寫實際結果 */
export function PlanComplete({ plan, catalog, onClose, onDone }: Props) {
  const activity = plan.activityId ? catalog.activityById.get(plan.activityId) : undefined;
  const studyType = activity?.detailType;
  const spec = studyType ? STUDY_FIELDS[studyType] : undefined;
  const [study, setStudy] = useState<PlanStudy>(plan.study ?? {});
  const [sets, setSets] = useState<WorkoutSet[]>([emptySet()]);
  const [exercises, setExercises] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [logEntry, setLogEntry] = useState(!!plan.activityId);
  const [saving, setSaving] = useState(false);

  // 重訓：帶入上次練同肌群的動作（重量、次數沿用，方便直接改）
  useEffect(() => {
    if (!activity?.workout) return;
    void recentExercises().then(setExercises);
    void lastWorkout(plan.muscles, plan.id).then((last) => {
      if (last?.length) setSets(last.map((w) => ({ ...w })));
    });
  }, [activity?.workout, plan.id, plan.muscles]);

  const start = planStart(plan);
  const end = start + (plan.durationMin || DEFAULT_PLAN_MIN) * MIN;
  const totalSets = sets.reduce((n, s) => n + (s.exercise.trim() ? (s.sets ?? 0) : 0), 0);
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const update = (i: number, patch: Partial<WorkoutSet>) => setSets((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function finish() {
    setSaving(true);
    await completePlan(plan, {
      result: { study: spec ? study : undefined, workout: activity?.workout ? sets : undefined, note },
      logEntry,
      activity,
    });
    void rescheduleReminders();
    onDone(logEntry && plan.activityId ? '完成！已記到時間軸' : '完成！');
    onClose();
  }

  const target = targetText(plan);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="完成安排">
        <div className="sheet-body">
          <div className="sheet-title">
            完成：{plan.time} {plan.title}
          </div>
          {target && <div className="target-box">目標：{target}</div>}

          {spec && (
            <>
              <div className="section-label">實際{studyType === 'reading' ? '讀了' : '進度'}</div>
              <label className="field compact">
                <span>{spec.titleLabel}</span>
                <input value={study.title ?? ''} onChange={(e) => setStudy({ ...study, title: e.target.value })} placeholder={spec.titlePlaceholder} />
              </label>
              {usesPages(studyType) ? (
                <div className="field compact">
                  <span>頁數</span>
                  <div className="range-row">
                    <span>p.</span>
                    <input type="number" inputMode="numeric" value={study.pageFrom ?? ''} placeholder="從" onChange={(e) => setStudy({ ...study, pageFrom: num(e.target.value) })} />
                    <span>–</span>
                    <input type="number" inputMode="numeric" value={study.pageTo ?? ''} placeholder="到" onChange={(e) => setStudy({ ...study, pageTo: num(e.target.value) })} />
                  </div>
                  {plan.study?.pageTo != null && study.pageTo != null && study.pageTo < plan.study.pageTo && (
                    <small className="muted">比目標少 {plan.study.pageTo - study.pageTo} 頁，沒關係，下次接著讀</small>
                  )}
                </div>
              ) : (
                <label className="field compact">
                  <span>{spec.progressLabel ?? '進度'}</span>
                  <input value={study.progress ?? ''} onChange={(e) => setStudy({ ...study, progress: e.target.value })} />
                </label>
              )}
            </>
          )}

          {activity?.workout && (
            <>
              <div className="section-label">
                做了什麼
                <span className="muted">
                  {' '}
                  · 共 {totalSets} 組{plan.targetSets ? ` / 目標 ${plan.targetSets}` : ''}
                </span>
              </div>
              <datalist id="exercise-list">
                {exercises.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
              <div className="workout-head">
                <span>動作</span>
                <span>重量kg</span>
                <span>次數</span>
                <span>組數</span>
                <span />
              </div>
              {sets.map((s, i) => (
                <div key={i} className="workout-row">
                  <input list="exercise-list" value={s.exercise} placeholder="例如 臥推" onChange={(e) => update(i, { exercise: e.target.value })} />
                  <input type="number" inputMode="decimal" value={s.weight ?? ''} onChange={(e) => update(i, { weight: num(e.target.value) })} aria-label="重量" />
                  <input type="number" inputMode="numeric" value={s.reps ?? ''} onChange={(e) => update(i, { reps: num(e.target.value) })} aria-label="次數" />
                  <input type="number" inputMode="numeric" value={s.sets ?? ''} onChange={(e) => update(i, { sets: num(e.target.value) })} aria-label="組數" />
                  <button className="text-btn" onClick={() => setSets((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [emptySet()]))} aria-label="移除這個動作">
                    ×
                  </button>
                </div>
              ))}
              <button className="add-row" onClick={() => setSets((list) => [...list, emptySet()])}>
                ＋ 加一個動作
              </button>
            </>
          )}

          <label className="field">
            <span>心得／備註（選填）</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：今天狀況很好" />
          </label>
          {plan.activityId && (
            <label className="toggle-row">
              <input type="checkbox" checked={logEntry} onChange={(e) => setLogEntry(e.target.checked)} />
              <span>
                記到時間軸
                <small className="muted">
                  （{fmtHM(start)}–{fmtHM(end)} {activity?.name}）
                </small>
              </span>
            </label>
          )}
        </div>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={saving} onClick={finish}>
            ✓ 完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
