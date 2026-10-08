import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { entriesOverlapping, getSettings } from './repo';
import { addDays, findGaps, periodsForDay, todayKey } from './time';

export const isNative = Capacitor.isNativePlatform();

const CHANNEL_ID = 'review';
/** 一次排好未來幾天的提醒；每次開 App 會再往後補 */
const DAYS_AHEAD = 30;
const TEST_ID = 1;

export interface ReviewTarget {
  date: string;
  reminderId: string;
}

/** 通知 id：yyyymmdd * 10 + 提醒序號，保證不同天、不同時段不重複 */
function notificationId(dateKey: string, index: number): number {
  return Number(dateKey.replaceAll('-', '')) * 10 + index;
}

export async function ensureChannel(): Promise<void> {
  if (!isNative) return;
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: '回顧提醒',
    description: '午餐、晚餐、睡前提醒你補記時間',
    importance: 4,
    visibility: 1,
    vibration: true,
  });
}

export async function notificationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNative) return 'denied';
  const p = await LocalNotifications.checkPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative) return false;
  const p = await LocalNotifications.requestPermissions();
  return p.display === 'granted';
}

export async function exactAlarmGranted(): Promise<boolean> {
  if (!isNative || Capacitor.getPlatform() !== 'android') return true;
  const s = await LocalNotifications.checkExactNotificationSetting();
  return s.exact_alarm === 'granted';
}

export async function openExactAlarmSetting(): Promise<void> {
  if (!isNative) return;
  await LocalNotifications.changeExactNotificationSetting();
}

let running: Promise<number> | null = null;

/**
 * 重新排程所有回顧提醒。
 * 已經完整記錄的時段不排（例如中午前就把早上記完了，午餐就不會吵你）。
 * 回傳排了幾則。
 */
export function rescheduleReminders(now = Date.now()): Promise<number> {
  // 避免同時多次觸發時互相干擾
  running = (running ?? Promise.resolve(0)).catch(() => 0).then(() => doReschedule(now));
  return running;
}

async function doReschedule(now: number): Promise<number> {
  if (!isNative) return 0;
  if ((await notificationPermission()) !== 'granted') return 0;
  await ensureChannel();

  const pending = (await LocalNotifications.getPending()).notifications.filter((n) => n.id !== TEST_ID);
  if (pending.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
  }

  const settings = await getSettings();
  const enabled = settings.reminders.filter((r) => r.enabled);
  if (enabled.length === 0) return 0;

  const toSchedule = [];
  const today = todayKey();
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const date = addDays(today, d);
    const periods = periodsForDay(date, settings.reminders);
    for (const [index, p] of periods.entries()) {
      if (!p.reminder.enabled || p.fireAt <= now) continue;
      if (d === 0) {
        const gaps = findGaps(
          { start: p.range.start, end: p.fireAt },
          await entriesOverlapping({ start: p.range.start, end: p.fireAt }),
        );
        if (gaps.length === 0) continue;
      }
      const target: ReviewTarget = { date, reminderId: p.reminder.id };
      toSchedule.push({
        id: notificationId(date, index),
        title: `${p.reminder.label}：${p.reminder.periodLabel}做了什麼？`,
        body: `點一下補記${p.reminder.periodLabel}的空白時段`,
        channelId: CHANNEL_ID,
        schedule: { at: new Date(p.fireAt), allowWhileIdle: true },
        extra: target,
        autoCancel: true,
      });
    }
  }
  if (toSchedule.length > 0) await LocalNotifications.schedule({ notifications: toSchedule });
  return toSchedule.length;
}

export async function sendTestNotification(): Promise<void> {
  if (!isNative) {
    alert('測試通知只能在手機 App 上使用');
    return;
  }
  await ensureChannel();
  const settings = await getSettings();
  const first = settings.reminders[0];
  const target: ReviewTarget = { date: todayKey(), reminderId: first?.id ?? 'morning' };
  await LocalNotifications.schedule({
    notifications: [
      {
        id: TEST_ID,
        title: '測試提醒',
        body: '10 秒後收到這則就代表提醒正常；點一下會打開回顧畫面',
        channelId: CHANNEL_ID,
        schedule: { at: new Date(Date.now() + 10_000), allowWhileIdle: true },
        extra: target,
        autoCancel: true,
      },
    ],
  });
}

export function onReviewNotificationTap(handler: (t: ReviewTarget) => void): void {
  if (!isNative) return;
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const extra = action.notification.extra as Partial<ReviewTarget> | undefined;
    if (extra?.date && extra.reminderId) handler({ date: extra.date, reminderId: extra.reminderId });
  });
}
