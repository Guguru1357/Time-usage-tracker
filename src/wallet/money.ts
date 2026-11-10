import { db, uid, type GiftCard, type Meal, type QuickItem, type Subscription } from '../db';
import { addDays, dayStart, toDateKey } from '../time';

export const DEFAULT_USD_RATE = 32;

export function fmtTWD(n: number): string {
  return `NT$${Math.round(n).toLocaleString('zh-TW')}`;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('zh-TW');
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: toDateKey(new Date(y, m - 1, 1)), to: toDateKey(new Date(y, m, 0)) };
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return toDateKey(new Date(y, m - 1 + n, 1)).slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

// ---------- 記帳 ----------

export const MEALS: Record<Meal, string> = { meal: '正餐', snack: '點心' };

/** 依時段猜正餐／點心 */
export function guessMeal(hour = new Date().getHours()): Meal {
  return (hour >= 6 && hour < 10) || (hour >= 11 && hour < 14) || (hour >= 17 && hour < 21) ? 'meal' : 'snack';
}

export function quickId(cat: string, meal: Meal | undefined, item: string): string {
  return `${cat}|${meal ?? ''}|${item}`;
}

export function sortQuickItems(list: QuickItem[]): QuickItem[] {
  return [...list].sort((a, b) => b.count - a.count || b.last - a.last);
}

// ---------- 訂閱 ----------

export const SUB_CATEGORIES: Record<Subscription['category'], string> = {
  video: '影音',
  tool: '工具',
  shopping: '購物外送',
  other: '其他',
};
export const SUB_STATUS: Record<Subscription['status'], string> = {
  active: '使用中',
  considering: '考慮取消',
  cancelled: '已取消',
};

export function chargeTWD(s: Subscription, usdRate: number): number {
  return s.amount * (s.currency === 'USD' ? usdRate : 1);
}

export function monthlyTWD(s: Subscription, usdRate: number): number {
  return chargeTWD(s, usdRate) / (s.cycle === 'yearly' ? 12 : 1);
}

function clampDate(y: number, m: number, day: number): Date {
  return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
}

/** 從 from（含）起算的下一次扣款日 */
export function nextCharge(s: Subscription, from: string): string | undefined {
  if (!s.billingDay) return undefined;
  const f = new Date(dayStart(from));
  if (s.cycle === 'yearly') {
    if (!s.billingMonth) return undefined;
    let d = clampDate(f.getFullYear(), s.billingMonth - 1, s.billingDay);
    if (d < f) d = clampDate(f.getFullYear() + 1, s.billingMonth - 1, s.billingDay);
    return toDateKey(d);
  }
  let d = clampDate(f.getFullYear(), f.getMonth(), s.billingDay);
  if (d < f) d = clampDate(f.getFullYear(), f.getMonth() + 1, s.billingDay);
  return toDateKey(d);
}

export function needsSetup(s: Subscription): boolean {
  return !s.amount || !s.billingDay || (s.cycle === 'yearly' && !s.billingMonth);
}

export const DEFAULT_SUBS: [string, Subscription['category']][] = [
  ['巴哈姆特動畫瘋', 'video'],
  ['Netflix', 'video'],
  ['Google One', 'tool'],
  ['YouTube Premium', 'video'],
  ['Claude', 'tool'],
  ['Uber One', 'shopping'],
  ['蝦皮', 'shopping'],
];

/** 第一次打開訂閱頁時建立預設清單（金額、扣款日讓使用者自己填） */
export async function ensureDefaultSubs(): Promise<void> {
  const flag = await db.kv.get('subs:seeded');
  if (flag) return;
  await db.transaction('rw', db.subscriptions, db.kv, async () => {
    if ((await db.subscriptions.count()) === 0) {
      await db.subscriptions.bulkAdd(
        DEFAULT_SUBS.map(([name, category]) => ({ id: uid(), name, amount: 0, currency: 'TWD', cycle: 'monthly', category, status: 'active' })),
      );
    }
    await db.kv.put({ key: 'subs:seeded', value: true });
  });
}

// ---------- 禮券 ----------

export const GIFT_PRESETS: { name: string; emoji: string; unit?: 'points'; denom?: number }[] = [
  { name: '7-11 禮券', emoji: '🏪', denom: 100 },
  { name: '星巴克禮券', emoji: '☕' },
  { name: '全聯禮券', emoji: '🛒' },
  { name: '新光三越禮券', emoji: '🏬' },
  { name: '麥當勞點點卡', emoji: '🍟', unit: 'points' },
];

export function giftBalance(g: GiftCard): number {
  return round2(g.log.reduce((a, l) => a + l.amount, 0));
}

export function giftTotal(g: GiftCard): number {
  return g.log.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0) || giftBalance(g);
}

export function isCountable(g: GiftCard): boolean {
  return g.unit === 'money' && !!g.denom && g.denom > 0;
}

export function giftCount(g: GiftCard): number {
  return isCountable(g) ? Math.floor(giftBalance(g) / g.denom! + 1e-9) : 0;
}

export function giftFmt(g: GiftCard, v: number): string {
  return g.unit === 'points' ? `${fmtNum(v)} 點` : fmtTWD(v);
}

export function giftDaysLeft(g: GiftCard, today: string): number | undefined {
  if (!g.expiry) return undefined;
  return Math.round((dayStart(g.expiry) - dayStart(today)) / 86_400_000);
}

/** 加一筆禮券紀錄；從資料庫讀最新版本，連續點擊也不會互相覆蓋 */
export async function addGiftLog(g: GiftCard, entry: Omit<GiftCard['log'][number], 'id'>): Promise<void> {
  await db.transaction('rw', db.giftCards, async () => {
    const cur = (await db.giftCards.get(g.id)) ?? g;
    await db.giftCards.put({ ...cur, log: [...cur.log, { id: uid(), ...entry, amount: round2(entry.amount) }] });
  });
}

/** 近 n 天的日期清單（含 to） */
export function lastDays(to: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(to, i - n + 1));
}
