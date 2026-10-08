import { App as CapApp } from '@capacitor/app';
import { useEffect, useRef, useState } from 'react';
import { isNative, onReviewNotificationTap, rescheduleReminders } from './notifications';
import { todayKey } from './time';
import { DayView } from './views/DayView';
import { ManageView } from './views/ManageView';
import { ReviewView } from './views/ReviewView';
import { SettingsView } from './views/SettingsView';

type Route =
  | { name: 'day'; date: string }
  | { name: 'review'; date: string; reminderId: string }
  | { name: 'manage' }
  | { name: 'settings' };

export function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'day', date: todayKey() }]);
  const route = stack[stack.length - 1];
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const push = (r: Route) => setStack((s) => [...s, r]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  // 切到其他分頁時保留目前看的日期；點「時間軸」回到今天
  const tab = (r: Route) =>
    setStack((s) =>
      r.name === 'day' ? [r] : [{ name: 'day', date: (s[0] as { date?: string }).date ?? todayKey() }, r],
    );

  useEffect(() => {
    void rescheduleReminders();
    onReviewNotificationTap((t) => {
      setStack([{ name: 'day', date: t.date }, { name: 'review', date: t.date, reminderId: t.reminderId }]);
    });
    if (!isNative) return;
    const subs = [
      CapApp.addListener('resume', () => void rescheduleReminders()),
      CapApp.addListener('backButton', () => {
        // 有開著的底部面板時先關面板
        const backdrop = document.querySelector<HTMLElement>('.sheet-backdrop');
        if (backdrop) return backdrop.click();
        if (stackRef.current.length > 1) back();
        else void CapApp.minimizeApp();
      }),
    ];
    return () => subs.forEach((p) => void p.then((h) => h.remove()));
  }, []);

  return (
    <div className="app">
      <main>
        {route.name === 'day' && (
          <DayView
            dateKey={route.date}
            onDate={(d) => setStack((s) => [...s.slice(0, -1), { name: 'day', date: d }])}
            onReview={(id) => push({ name: 'review', date: route.date, reminderId: id })}
          />
        )}
        {route.name === 'review' && <ReviewView dateKey={route.date} reminderId={route.reminderId} onBack={back} />}
        {route.name === 'manage' && <ManageView />}
        {route.name === 'settings' && <SettingsView />}
      </main>
      <nav className="tabbar">
        <button className={route.name === 'day' || route.name === 'review' ? 'active' : ''} onClick={() => tab({ name: 'day', date: todayKey() })}>
          <span className="tab-icon">◷</span>時間軸
        </button>
        <button className={route.name === 'manage' ? 'active' : ''} onClick={() => tab({ name: 'manage' })}>
          <span className="tab-icon">☰</span>活動
        </button>
        <button className={route.name === 'settings' ? 'active' : ''} onClick={() => tab({ name: 'settings' })}>
          <span className="tab-icon">⚙</span>設定
        </button>
      </nav>
    </div>
  );
}
