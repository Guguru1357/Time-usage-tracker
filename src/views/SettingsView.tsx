import { useEffect, useRef, useState } from 'react';
import { exportCsv, exportJson, parseBackup, restoreBackup } from '../backup';
import type { Reminder } from '../db';
import { TimeField } from '../components/TimeField';
import { useSettings } from '../hooks';
import {
  exactAlarmGranted,
  isNative,
  notificationPermission,
  openExactAlarmSetting,
  requestNotificationPermission,
  rescheduleReminders,
  sendTestNotification,
} from '../notifications';
import { updateSettings } from '../repo';

export function SettingsView() {
  const settings = useSettings();
  const [perm, setPerm] = useState<string>('…');
  const [exact, setExact] = useState<boolean | null>(null);
  const [scheduled, setScheduled] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function refreshStatus() {
    setPerm(await notificationPermission());
    setExact(await exactAlarmGranted());
    setScheduled(await rescheduleReminders());
  }
  useEffect(() => {
    void refreshStatus();
    const onVis = () => document.visibilityState === 'visible' && void refreshStatus();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  async function updateReminder(id: string, patch: Partial<Reminder>) {
    await updateSettings({ reminders: settings.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
    setScheduled(await rescheduleReminders());
  }

  async function onImport(file: File) {
    try {
      const backup = parseBackup(await file.text());
      if (!confirm(`備份含 ${backup.entries.length} 筆紀錄（${backup.exportedAt.slice(0, 10)}）。\n匯入會「取代」目前所有資料，確定嗎？`)) return;
      await restoreBackup(backup);
      setScheduled(await rescheduleReminders());
      setMsg('匯入完成');
    } catch (e) {
      setMsg(`匯入失敗：${(e as Error).message}`);
    }
  }

  async function run(fn: () => Promise<void>, done: string) {
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setMsg(`失敗：${(e as Error).message}`);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>設定</h2>
      </header>
      {msg && (
        <div className="toast" onClick={() => setMsg('')}>
          {msg}
        </div>
      )}

      <section className="card">
        <h3>回顧提醒</h3>
        {settings.reminders.map((r) => (
          <div key={r.id} className="reminder-row">
            <label className="switch">
              <input type="checkbox" checked={r.enabled} onChange={(e) => updateReminder(r.id, { enabled: e.target.checked })} />
              <span />
            </label>
            <div className="reminder-text">
              <b>{r.label}</b>
              <small className="muted">回顧{r.periodLabel}</small>
            </div>
            <TimeField value={r.time} onChange={(v) => updateReminder(r.id, { time: v })} />
          </div>
        ))}
        <p className="muted small">
          每個提醒回顧「上一個提醒到這個提醒」之間的時段，最後一個回顧到午夜。若在提醒前已經記完，當次就不會通知。
        </p>
      </section>

      <section className="card">
        <h3>提醒狀態</h3>
        {!isNative ? (
          <p className="muted">目前是瀏覽器預覽版，提醒只有在手機 App 上才會運作。</p>
        ) : (
          <>
            <div className="status-row">
              <span>通知權限</span>
              {perm === 'granted' ? (
                <span className="ok">✓ 已允許</span>
              ) : (
                <button className="btn primary sm" onClick={async () => (await requestNotificationPermission(), refreshStatus())}>
                  允許通知
                </button>
              )}
            </div>
            <div className="status-row">
              <span>準時鬧鐘</span>
              {exact ? (
                <span className="ok">✓ 已允許</span>
              ) : (
                <button className="btn primary sm" onClick={() => openExactAlarmSetting()}>
                  前往開啟
                </button>
              )}
            </div>
            <div className="status-row">
              <span>已排程提醒</span>
              <span>{scheduled ?? '…'} 則（未來 30 天）</span>
            </div>
            <button className="btn block" onClick={() => run(sendTestNotification, '10 秒後會收到測試通知，可以先把 App 關掉試試')}>
              傳送測試通知（10 秒後）
            </button>
            <details className="help">
              <summary>收不到提醒怎麼辦？</summary>
              <ol>
                <li>系統設定 → 應用程式 → 時間記帳 → 通知：確認「回顧提醒」已開啟。</li>
                <li>
                  系統設定 → 應用程式 → 時間記帳 → 應用程式電池用量：選「<b>不受限制</b>」。
                </li>
                <li>不要從「最近使用的應用程式」把 App 強制停止（滑掉沒關係，但「強制停止」會清掉排程）。</li>
                <li>每次打開 App 都會自動補排未來 30 天的提醒，至少一個月開一次就不會斷。</li>
              </ol>
            </details>
          </>
        )}
      </section>

      <section className="card">
        <h3>外觀</h3>
        <div className="segmented">
          {(
            [
              ['light', '淺色'],
              ['dark', '深色'],
              ['system', '跟隨系統'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={(settings.theme ?? 'light') === v ? 'active' : ''} onClick={() => updateSettings({ theme: v })}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>時間刻度</h3>
        <div className="segmented">
          {[5, 10, 15, 30].map((s) => (
            <button key={s} className={settings.step === s ? 'active' : ''} onClick={() => updateSettings({ step: s })}>
              {s} 分
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>備份</h3>
        <p className="muted small">資料只存在這支手機。建議定期匯出 JSON（完整備份）存到雲端硬碟。</p>
        <div className="btn-row">
          <button className="btn" onClick={() => run(exportJson, '已匯出 JSON')}>
            匯出 JSON
          </button>
          <button className="btn" onClick={() => run(exportCsv, '已匯出 CSV')}>
            匯出 CSV
          </button>
        </div>
        <button className="btn ghost block" onClick={() => fileInput.current?.click()}>
          從 JSON 還原…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onImport(f);
          }}
        />
      </section>
      <p className="muted small center">時間記帳 v{__APP_VERSION__}</p>
    </div>
  );
}
