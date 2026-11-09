import { useMemo, type ReactNode } from 'react';
import { IconChart, IconClock, IconList, IconToday } from '../components/Icons';
import { activitiesByDate, habitDay, isScheduled } from '../habits';
import { useCatalog, useEntries, useHabitLogs, useHabits, usePlans } from '../hooks';
import { planStart, targetText } from '../plans';
import { dayEnd, dayStart, fmtHours, todayKey } from '../time';

export type HomeTarget = 'today' | 'day' | 'stats' | 'manage' | 'settings';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function greeting(h: number): string {
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  return '晚安';
}

/** 首頁：只放今天最需要的資訊，其他功能用大按鈕進入 */
export function HomeView({ onOpen }: { onOpen: (t: HomeTarget) => void }) {
  const date = todayKey();
  const catalog = useCatalog();
  const plans = usePlans(date);
  const habits = useHabits();
  const logs = useHabitLogs(date, date);
  const entries = useEntries({ start: dayStart(date), end: dayEnd(date) });
  const acts = useMemo(() => activitiesByDate(entries ?? []), [entries]);

  const now = new Date();
  const pending = (plans ?? []).filter((p) => !p.doneAt);
  // 下一件事：還沒做的安排中最早的一個（包含已經過時間但還沒打勾的）
  const next = pending[0];
  const todays = (habits ?? []).filter((h) => isScheduled(h, date));
  const habitsDone = logs ? todays.filter((h) => habitDay(h, date, logs, acts).done).length : 0;
  const recorded = (entries ?? []).reduce(
    (s, e) => s + Math.max(0, Math.min(e.end, dayEnd(date)) - Math.max(e.start, dayStart(date))),
    0,
  );

  const tiles: { id: HomeTarget; icon: ReactNode; title: string; desc: string }[] = [
    { id: 'today', icon: <IconToday />, title: '今日安排', desc: '行程打勾、習慣' },
    { id: 'day', icon: <IconClock />, title: '時間軸', desc: '記錄時間花在哪' },
    { id: 'stats', icon: <IconChart />, title: '統計', desc: '每日、每週時數' },
    { id: 'manage', icon: <IconList />, title: '活動', desc: '活動與分類' },
  ];

  return (
    <div className="page home">
      <header className="home-header">
        <div className="home-date">
          {now.getMonth() + 1} 月 {now.getDate()} 日 星期{WEEKDAYS[now.getDay()]}
        </div>
        <h2>{greeting(now.getHours())}</h2>
      </header>

      <button className="next-card" onClick={() => onOpen('today')}>
        <span className="next-label">下一件事</span>
        {!plans ? (
          <span className="next-title muted">載入中…</span>
        ) : next ? (
          <>
            <span className="next-title">
              <span className="next-time">{next.time}</span>
              {next.title}
            </span>
            {targetText(next) && <span className="next-sub">{targetText(next)}</span>}
            {planStart(next) < Date.now() && <span className="next-sub">時間到了，做完記得打勾</span>}
          </>
        ) : plans.length ? (
          <span className="next-title">今天的安排都完成了 ✓</span>
        ) : (
          <span className="next-title muted">今天還沒有安排，點這裡新增</span>
        )}
      </button>

      <div className="home-stats">
        <div>
          <span>安排</span>
          <b>
            {(plans?.length ?? 0) - pending.length} / {plans?.length ?? 0}
          </b>
        </div>
        <div>
          <span>習慣</span>
          <b>
            {habitsDone} / {todays.length}
          </b>
        </div>
        <div>
          <span>已記錄</span>
          <b>{catalog ? fmtHours(recorded) : '—'}</b>
        </div>
      </div>

      <div className="home-grid">
        {tiles.map((t) => (
          <button key={t.id} className="home-tile" onClick={() => onOpen(t.id)}>
            <span className="home-icon">{t.icon}</span>
            <span className="home-title">{t.title}</span>
            <span className="home-desc">{t.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
