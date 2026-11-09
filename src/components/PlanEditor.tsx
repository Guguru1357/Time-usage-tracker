import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Plan, PlanStudy } from '../db';
import type { Catalog } from '../hooks';
import { rescheduleReminders } from '../notifications';
import { MUSCLE_GROUPS, cleanPlanStudy, deletePlan, savePlan } from '../plans';
import { STUDY_FIELDS, recentTitles } from '../study';
import { fmtDateLabel } from '../time';
import { ActButton, ActivityPickerSheet } from './ActivityPicker';
import { TimeField } from './TimeField';

interface Props {
  catalog: Catalog;
  step: number;
  /** 編輯既有安排，或新增到某天 */
  plan?: Plan;
  date: string;
  /** 新增時預設的時間 */
  defaultTime?: string;
  onClose: () => void;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

function addMin(hm: string, d: number): string {
  const [h, m] = hm.split(':').map(Number);
  const x = (((h * 60 + m + d) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

/** 閱讀類用頁數範圍；其他學習類用文字描述進度 */
export function usesPages(type: string | undefined): boolean {
  return type === 'reading';
}

export function PlanEditor({ catalog, step, plan, date: initialDate, defaultTime = '20:00', onClose }: Props) {
  const [date, setDate] = useState(plan?.date ?? initialDate);
  const [time, setTime] = useState(plan?.time ?? defaultTime);
  const [durationMin, setDurationMin] = useState<number | undefined>(plan ? plan.durationMin : 60);
  const [title, setTitle] = useState(plan?.title ?? '');
  const [activityId, setActivityId] = useState<string | undefined>(plan?.activityId);
  const [study, setStudy] = useState<PlanStudy>(plan?.study ?? {});
  const [muscles, setMuscles] = useState<string[]>(plan?.muscles ?? []);
  const [targetSets, setTargetSets] = useState<number | undefined>(plan?.targetSets);
  const [note, setNote] = useState(plan?.note ?? '');
  const [remind, setRemind] = useState(plan?.remind ?? true);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState('');

  const activity = activityId ? catalog.activityById.get(activityId) : undefined;
  const studyType = activity?.detailType;
  const spec = studyType ? STUDY_FIELDS[studyType] : undefined;
  const titles = useLiveQuery(() => (studyType ? recentTitles(studyType) : Promise.resolve([])), [studyType]) ?? [];
  const q = study.title?.trim() ?? '';
  const suggestions = titles.filter((t) => t !== q && (!q || t.includes(q))).slice(0, 6);

  function chooseActivity(id: string) {
    const prev = activityId ? catalog.activityById.get(activityId)?.name : undefined;
    setActivityId(id);
    // 名稱沒填或還是上一個活動名稱時，跟著換
    if (!title.trim() || title === prev) setTitle(catalog.activityById.get(id)?.name ?? '');
  }

  async function save() {
    const name = title.trim() || activity?.name || '';
    if (!name) return setError('請輸入要做什麼，或選擇一個活動');
    await savePlan({
      ...(plan ?? {}),
      id: plan?.id,
      date,
      time,
      durationMin,
      title: name,
      activityId,
      remind,
      study: studyType ? cleanPlanStudy(study) : undefined,
      muscles: activity?.workout && muscles.length ? muscles : undefined,
      targetSets: activity?.workout && targetSets ? targetSets : undefined,
      note: note.trim() || undefined,
    });
    void rescheduleReminders();
    onClose();
  }

  async function remove() {
    if (!plan) return;
    if (!confirm(`刪除「${plan.title}」這個安排？`)) return;
    await deletePlan(plan.id);
    void rescheduleReminders();
    onClose();
  }

  const num = (v: string) => (v === '' ? undefined : Number(v));

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="安排">
        <div className="sheet-body">
          <div className="sheet-title">
            {plan ? '編輯安排' : '新增安排'} · {fmtDateLabel(date)}
          </div>

          <div className="time-row">
            <span className="time-label">時間</span>
            <button className="step-btn" onClick={() => setTime(addMin(time, -step))} aria-label="提前">
              −
            </button>
            <TimeField value={time} onChange={setTime} />
            <button className="step-btn" onClick={() => setTime(addMin(time, step))} aria-label="延後">
              ＋
            </button>
            <label className="date-chip">
              改日期
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
          </div>
          <div className="chips">
            <span className="muted">長度</span>
            {DURATIONS.map((d) => (
              <button key={d} className={`chip${durationMin === d ? ' selected' : ''}`} onClick={() => setDurationMin(d)}>
                {d < 60 ? `${d}分` : `${d / 60}h`}
              </button>
            ))}
            <button className={`chip${durationMin === undefined ? ' selected' : ''}`} onClick={() => setDurationMin(undefined)}>
              不設定
            </button>
          </div>

          <label className="field">
            <span>要做什麼</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：健身課、練前餐" />
          </label>

          <div className="section-label">連動活動（完成時記到時間軸）</div>
          {activity ? (
            <div className="selected-row">
              <ActButton name={activity.name} color={activity.color} selected onClick={() => setPicker(true)} />
              <button className="text-btn" onClick={() => setPicker(true)}>
                更換
              </button>
              <button className="text-btn" onClick={() => setActivityId(undefined)}>
                不連動
              </button>
            </div>
          ) : (
            <button className="add-row" onClick={() => setPicker(true)}>
              ＋ 選擇活動
            </button>
          )}

          {spec && (
            <div className="plan-target">
              <div className="section-label">目標</div>
              <label className="field compact">
                <span>{spec.titleLabel}</span>
                <input value={study.title ?? ''} placeholder={spec.titlePlaceholder} onChange={(e) => setStudy({ ...study, title: e.target.value })} />
              </label>
              {suggestions.length > 0 && (
                <div className="chips suggest">
                  {suggestions.map((t) => (
                    <button key={t} className="chip" onClick={() => setStudy({ ...study, title: t })}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
              {usesPages(studyType) ? (
                <div className="field compact">
                  <span>頁數</span>
                  <div className="range-row">
                    <span>p.</span>
                    <input type="number" inputMode="numeric" value={study.pageFrom ?? ''} placeholder="從" onChange={(e) => setStudy({ ...study, pageFrom: num(e.target.value) })} />
                    <span>–</span>
                    <input type="number" inputMode="numeric" value={study.pageTo ?? ''} placeholder="到" onChange={(e) => setStudy({ ...study, pageTo: num(e.target.value) })} />
                    {study.pageFrom != null && study.pageTo != null && study.pageTo >= study.pageFrom && (
                      <span className="muted small">共 {study.pageTo - study.pageFrom + 1} 頁</span>
                    )}
                  </div>
                </div>
              ) : (
                <label className="field compact">
                  <span>{spec.progressLabel ?? '進度目標'}</span>
                  <input value={study.progress ?? ''} placeholder={spec.progressPlaceholder ?? '例如：第 5 課、50 個單字'} onChange={(e) => setStudy({ ...study, progress: e.target.value })} />
                </label>
              )}
            </div>
          )}

          {activity?.workout && (
            <div className="plan-target">
              <div className="section-label">目標肌群</div>
              <div className="chips">
                {MUSCLE_GROUPS.map((m) => (
                  <button
                    key={m}
                    className={`chip${muscles.includes(m) ? ' selected' : ''}`}
                    onClick={() => setMuscles((list) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]))}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="field compact">
                <span>目標組數</span>
                <div className="range-row">
                  <button className="step-btn" onClick={() => setTargetSets(Math.max(0, (targetSets ?? 0) - 1) || undefined)} aria-label="減少組數">
                    −
                  </button>
                  <b className="count">{targetSets ?? '—'}</b>
                  <button className="step-btn" onClick={() => setTargetSets((targetSets ?? 0) + 1)} aria-label="增加組數">
                    ＋
                  </button>
                  <span className="muted small">組</span>
                </div>
              </div>
            </div>
          )}

          <label className="field">
            <span>備註（選填）</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：帶毛巾、先熱身 10 分鐘" />
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            <span>
              到時間提醒我
              <small className="muted">（通知上可以直接按「完成」）</small>
            </span>
          </label>
          {error && <div className="error">{error}</div>}
        </div>
        {picker && (
          <ActivityPickerSheet
            title="連動活動"
            catalog={catalog}
            onSelect={(id) => chooseActivity(id)}
            onClose={() => setPicker(false)}
          />
        )}
        <div className="sheet-actions">
          {plan ? (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          )}
          <button className="btn primary" onClick={save}>
            儲存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
