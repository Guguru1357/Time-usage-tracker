import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { IconChevronLeft, IconChevronRight, IconPlus } from '../components/Icons';
import { HabitManager } from '../components/HabitManager';
import { PlanComplete } from '../components/PlanComplete';
import { PlanEditor } from '../components/PlanEditor';
import { db, type Habit, type Plan } from '../db';
import { activitiesByDate, bumpHabit, habitDay, isScheduled, streak } from '../habits';
import { useCatalog, useEntries, useHabitLogs, useHabits, usePlans, useSettings } from '../hooks';
import { rescheduleReminders } from '../notifications';
import { completePlan, copyPlans, planStart, previousPlanDate, resultText, targetText, uncompletePlan } from '../plans';
import { addDays, dayEnd, dayStart, fmtDateLabel, todayKey } from '../time';

/** 從通知進來時要處理的安排 */
export interface PlanFocus {
  planId: string;
  done: boolean;
  nonce: number;
}

interface Props {
  dateKey: string;
  onDate: (d: string) => void;
  focus?: PlanFocus;
}

/** 串連天數往回看的範圍 */
const STREAK_DAYS = 120;

export function TodayView({ dateKey, onDate, focus }: Props) {
  const catalog = useCatalog();
  const settings = useSettings();
  const plans = usePlans(dateKey);
  const habits = useHabits();
  const from = addDays(dateKey, -STREAK_DAYS);
  const logs = useHabitLogs(from, dateKey);
  const entries = useEntries({ start: dayStart(from), end: dayEnd(dateKey) });
  const prevDate = useLiveQuery(() => previousPlanDate(dateKey), [dateKey]);
  const [editor, setEditor] = useState<{ plan?: Plan } | null>(null);
  const [completing, setCompleting] = useState<Plan | null>(null);
  const [habitManager, setHabitManager] = useState(false);
  const [toast, setToast] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);

  const acts = useMemo(() => activitiesByDate(entries ?? []), [entries]);

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 2500);
  };

  const needsDetails = (p: Plan) => {
    const a = p.activityId ? catalog?.activityById.get(p.activityId) : undefined;
    return !!(a?.detailType || a?.workout);
  };

  async function check(p: Plan) {
    if (!catalog) return;
    if (p.doneAt) {
      if (!confirm(`取消「${p.title}」的完成？${p.entryId ? '\n時間軸上自動記的那筆也會刪除。' : ''}`)) return;
      await uncompletePlan(p);
      void rescheduleReminders();
      return;
    }
    if (needsDetails(p)) return setCompleting(p);
    const activity = p.activityId ? catalog.activityById.get(p.activityId) : undefined;
    await completePlan(p, { logEntry: !!activity, activity });
    void rescheduleReminders();
    say(activity ? '完成！已記到時間軸' : '完成！');
  }

  // 從通知點進來：按「完成」就直接打勾（有細節的打開填寫畫面），點通知本身則標示那一項
  useEffect(() => {
    if (!focus || !catalog) return;
    void db.plans.get(focus.planId).then((p) => {
      if (!p) return;
      setHighlight(p.id);
      if (focus.done && !p.doneAt) void check(p);
    });
  }, [focus?.nonce, !!catalog]);

  if (!catalog || !plans || !habits || !logs) return <div className="loading">載入中…</div>;

  const isToday = dateKey === todayKey();
  const now = Date.now();
  const doneCount = plans.filter((p) => p.doneAt).length;
  const todays = habits.filter((h) => isScheduled(h, dateKey));
  const resting = habits.filter((h) => !isScheduled(h, dateKey));
  const habitsDone = todays.filter((h) => habitDay(h, dateKey, logs, acts).done).length;
  const lastTime = plans.length ? plans[plans.length - 1].time : undefined;

  async function tapHabit(h: Habit) {
    const day = habitDay(h, dateKey, logs!, acts);
    if (day.fromTimeline && day.count === 0) return say(`時間軸已有「${catalog!.activityById.get(h.activityId!)?.name}」，自動算完成`);
    if (h.target === 1) await bumpHabit(h.id, dateKey, day.count > 0 ? -day.count : 1);
    else await bumpHabit(h.id, dateKey, day.count >= h.target ? -day.count : 1);
  }

  return (
    <div className="page today">
      <header className="day-header">
        <label className="date-pick">
          <span className="date-title">{fmtDateLabel(dateKey)}</span>
          <span className="date-sub">{isToday ? '今天' : dateKey === addDays(todayKey(), 1) ? '明天' : '點此選擇日期'}</span>
          <input type="date" value={dateKey} onChange={(e) => e.target.value && onDate(e.target.value)} />
        </label>
        <div className="day-nav">
          {isToday ? (
            <button className="text-btn" onClick={() => onDate(addDays(todayKey(), 1))}>
              明天
            </button>
          ) : (
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
          <span>安排</span>
          <b>
            {doneCount}
            <small> / {plans.length}</small>
          </b>
        </div>
        <div>
          <span>習慣</span>
          <b>
            {habitsDone}
            <small> / {todays.length}</small>
          </b>
        </div>
      </div>

      <h3>安排</h3>
      {plans.length === 0 ? (
        <div className="empty-box">
          <p>還沒有安排</p>
          {prevDate && (
            <button
              className="btn block"
              onClick={async () => {
                const n = await copyPlans(prevDate, dateKey);
                void rescheduleReminders();
                say(`已複製 ${n} 項`);
              }}
            >
              複製 {fmtDateLabel(prevDate)} 的安排
            </button>
          )}
        </div>
      ) : (
        <div className="plan-list">
          {plans.map((p) => {
            const overdue = !p.doneAt && isToday && planStart(p) < now;
            const target = targetText(p);
            const result = resultText(p.result);
            return (
              <div key={p.id} className={`plan-row${p.doneAt ? ' done' : ''}${overdue ? ' overdue' : ''}${highlight === p.id ? ' focus' : ''}`}>
                <button className="check" onClick={() => void check(p)} aria-label={p.doneAt ? '取消完成' : '完成'}>
                  <span className="box">{p.doneAt ? '✓' : ''}</span>
                </button>
                <button className="plan-main" onClick={() => setEditor({ plan: p })}>
                  <span className="plan-time">{p.time}</span>
                  <span className="plan-text">
                    <span className="plan-title">
                      {p.title}
                      {p.remind && !p.doneAt && <span className="bell" aria-label="會提醒">🔔</span>}
                    </span>
                    {target && <span className="plan-sub">目標：{target}</span>}
                    {result && <span className="plan-result">結果：{result}</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button className="add-row" onClick={() => setEditor({})}>
        ＋ 新增安排
      </button>

      <div className="section-head">
        <h3>習慣</h3>
        <button className="text-btn" onClick={() => setHabitManager(true)}>
          管理
        </button>
      </div>
      {todays.length === 0 ? (
        <div className="empty-box">
          <p>{habits.length ? '今天沒有排定的習慣' : '還沒有習慣'}</p>
        </div>
      ) : (
        <div className="habit-grid">
          {todays.map((h) => {
            const day = habitDay(h, dateKey, logs, acts);
            const s = streak(h, dateKey, logs, acts, STREAK_DAYS);
            return (
              <button key={h.id} className={`habit-tile${day.done ? ' done' : ''}`} onClick={() => void tapHabit(h)}>
                <span className="habit-emoji">{h.emoji}</span>
                <span className="habit-name">{h.name}</span>
                <span className="habit-state">
                  {h.target > 1 ? `${Math.min(day.count, h.target)} / ${h.target}` : day.done ? '✓ 完成' : '未完成'}
                  {day.fromTimeline && day.count === 0 && ' · 時間軸'}
                </span>
                {s > 0 && <span className="habit-streak">連續 {s} 天</span>}
              </button>
            );
          })}
        </div>
      )}
      {resting.length > 0 && <p className="muted small">今天休息：{resting.map((h) => h.name).join('、')}</p>}

      <button className="fab" onClick={() => setEditor({})} aria-label="新增安排">
        <IconPlus size={26} />
      </button>

      {toast && (
        <div className="toast" onClick={() => setToast('')}>
          {toast}
        </div>
      )}
      {editor && (
        <PlanEditor
          catalog={catalog}
          step={settings.step}
          plan={editor.plan}
          date={dateKey}
          defaultTime={lastTime ?? '18:00'}
          onClose={() => setEditor(null)}
        />
      )}
      {completing && <PlanComplete plan={completing} catalog={catalog} onClose={() => setCompleting(null)} onDone={say} />}
      {habitManager && <HabitManager catalog={catalog} onClose={() => setHabitManager(false)} />}
    </div>
  );
}
