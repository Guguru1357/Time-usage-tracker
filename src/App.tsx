import { App as CapApp } from '@capacitor/app';
import { useEffect, useRef, useState } from 'react';
import { IconClock, IconHome, IconSettings, IconToday, IconWallet } from './components/Icons';
import { useSettings } from './hooks';
import { isNative, onNotificationTap, rescheduleReminders } from './notifications';
import { applyTheme } from './theme';
import { UpdateSheet } from './components/UpdateSheet';
import { autoCheck, type UpdateInfo } from './updater';
import { fmtTWD } from './wallet/money';
import { processSubCharges } from './wallet/subCharges';
import { todayKey } from './time';
import { DayView } from './views/DayView';
import { HomeView } from './views/HomeView';
import { ManageView } from './views/ManageView';
import { ReviewView } from './views/ReviewView';
import { SettingsView } from './views/SettingsView';
import { StatsView } from './views/StatsView';
import { TodayView, type PlanFocus } from './views/TodayView';
import { WalletView, type WalletFocus, type WalletPage } from './views/WalletView';

type Route =
  | { name: 'home' }
  | { name: 'today'; date: string; focus?: PlanFocus }
  | { name: 'day'; date: string }
  | { name: 'review'; date: string; reminderId: string }
  | { name: 'stats' }
  | { name: 'wallet'; page: WalletPage; focus?: WalletFocus }
  | { name: 'manage' }
  | { name: 'settings' };

export function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];
  const theme = useSettings().theme;
  const [charged, setCharged] = useState('');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => applyTheme(theme), [theme]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const push = (r: Route) => setStack((s) => [...s, r]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  // 分頁都疊在首頁上面，按返回鍵回到首頁
  const tab = (r: Route) => setStack(r.name === 'home' ? [r] : [{ name: 'home' }, r]);

  useEffect(() => {
    void rescheduleReminders();
    const check = () => {
      void autoCheck().then((u) => u && setUpdate(u));
      // 到了扣款日的訂閱自動扣款
      void processSubCharges().then((made) => {
        if (made.length) setCharged(`已自動扣款：${made.map((c) => `${c.name} ${fmtTWD(c.amount)}`).join('、')}`);
      });
    };
    check();
    onNotificationTap({
      review: (t) => setStack([{ name: 'home' }, { name: 'day', date: t.date }, { name: 'review', date: t.date, reminderId: t.reminderId }]),
      plan: (t) => setStack([{ name: 'home' }, { name: 'today', date: t.date, focus: { planId: t.planId, done: t.done, nonce: Date.now() } }]),
      wallet: (t) => setStack([{ name: 'home' }, { name: 'wallet', page: t.wallet, focus: { date: t.date, action: t.action, nonce: Date.now() } }]),
    });
    if (!isNative) return;
    const subs = [
      CapApp.addListener('resume', () => {
        void rescheduleReminders();
        check();
      }),
      CapApp.addListener('backButton', () => {
        // 有開著的底部面板時先關面板
        const backdrops = document.querySelectorAll<HTMLElement>('.sheet-backdrop');
        if (backdrops.length) return backdrops[backdrops.length - 1].click();
        if (stackRef.current.length > 1) back();
        else void CapApp.minimizeApp();
      }),
    ];
    return () => subs.forEach((p) => void p.then((h) => h.remove()));
  }, []);

  return (
    <div className="app">
      <main>
        {charged && (
          <div className="update-banner">
            <span>{charged}</span>
            <button className="text-btn" onClick={() => setCharged('')}>
              知道了
            </button>
          </div>
        )}
        {update && !updateDismissed && (
          <div className="update-banner">
            <span>有新版本 #{update.build}</span>
            <button className="text-btn" onClick={() => setUpdateDismissed(true)}>
              稍後
            </button>
            <button className="btn primary sm" onClick={() => setUpdateOpen(true)}>
              查看
            </button>
          </div>
        )}
        {route.name === 'home' && (
          <HomeView
            onOpen={(t) =>
              t === 'today' || t === 'day'
                ? tab({ name: t, date: todayKey() })
                : t === 'stats'
                  ? tab({ name: 'stats' })
                  : tab({ name: 'wallet', page: t })
            }
          />
        )}
        {route.name === 'today' && (
          <TodayView
            dateKey={route.date}
            focus={route.focus}
            onDate={(d) => setStack((s) => [...s.slice(0, -1), { name: 'today', date: d }])}
          />
        )}
        {route.name === 'day' && (
          <DayView
            dateKey={route.date}
            onDate={(d) => setStack((s) => [...s.slice(0, -1), { name: 'day', date: d }])}
            onReview={(id) => push({ name: 'review', date: route.date, reminderId: id })}
          />
        )}
        {route.name === 'review' && <ReviewView dateKey={route.date} reminderId={route.reminderId} onBack={back} />}
        {route.name === 'stats' && <StatsView />}
        {route.name === 'manage' && <ManageView />}
        {route.name === 'settings' && <SettingsView onManage={() => push({ name: 'manage' })} />}
        {route.name === 'wallet' && (
          <WalletView page={route.page} focus={route.focus} onPage={(p) => setStack((s) => [...s.slice(0, -1), { name: 'wallet', page: p }])} />
        )}
      </main>
      {update && updateOpen && (
        <UpdateSheet
          info={update}
          onClose={() => {
            setUpdateOpen(false);
            setUpdateDismissed(true);
          }}
        />
      )}
      <nav className="tabbar">
        <button className={route.name === 'home' ? 'active' : ''} onClick={() => tab({ name: 'home' })}>
          <IconHome />
          首頁
        </button>
        <button className={route.name === 'today' ? 'active' : ''} onClick={() => tab({ name: 'today', date: todayKey() })}>
          <IconToday />
          今日
        </button>
        <button className={route.name === 'day' || route.name === 'review' ? 'active' : ''} onClick={() => tab({ name: 'day', date: todayKey() })}>
          <IconClock />
          時間軸
        </button>
        <button className={route.name === 'wallet' ? 'active' : ''} onClick={() => tab({ name: 'wallet', page: 'ledger' })}>
          <IconWallet />
          錢包
        </button>
        <button className={route.name === 'settings' || route.name === 'manage' ? 'active' : ''} onClick={() => tab({ name: 'settings' })}>
          <IconSettings />
          設定
        </button>
      </nav>
    </div>
  );
}
