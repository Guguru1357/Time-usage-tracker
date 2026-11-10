import { db, type Trade } from '../db';
import { adjustBalance } from './assets';
import { analyzePositions, tradeCash } from './positions';

export { analyzePositions, holdingsCost, isUS, sortTrades, tradeAmount, tradeCash, tradeFx, type Holding } from './positions';
import { addDays, dayStart } from '../time';
import { round2 } from './money';



export interface TradeReport {
  count: number;
  tradingDays: number;
  /** 定期定額的筆數 */
  dca: number;
  /** 期間內賣出的已實現損益合計 */
  realized: number;
}

/** 期間 [from, to] 內的交易統計 */
export function tradeReport(all: Trade[], from: string, to: string): TradeReport {
  const { realized } = analyzePositions(all);
  const list = all.filter((t) => t.date >= from && t.date <= to);
  return {
    count: list.length,
    tradingDays: new Set(list.map((t) => t.date)).size,
    dca: list.filter((t) => t.dca).length,
    realized: round2(list.reduce((a, t) => a + (realized.get(t.id) ?? 0), 0)),
  };
}

/** 每週交易筆數（週一開始），最後一週包含 to */
export function weeklyCounts(trades: Trade[], to: string, weeks: number): { start: string; count: number }[] {
  const d = new Date(dayStart(to));
  const monday = addDays(to, -((d.getDay() + 6) % 7));
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(monday, (i - weeks + 1) * 7);
    const end = addDays(start, 6);
    return { start, count: trades.filter((t) => t.date >= start && t.date <= end).length };
  });
}

/** 每日交易筆數：到 to 為止的 days 天（含 to） */
export function dailyCounts(trades: Trade[], to: string, days: number): { date: string; count: number }[] {
  const perDay = new Map<string, number>();
  for (const t of trades) perDay.set(t.date, (perDay.get(t.date) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(to, i - days + 1);
    return { date, count: perDay.get(date) ?? 0 };
  });
}

// ---------- 與證券交割戶同步 ----------


/**
 * 儲存交易並同步帳戶餘額。
 * 編輯時先把舊的金額還原，再套用新的，所以改價格、改帳戶或改成不同步都不會算錯。
 */
export async function saveTrade(t: Trade): Promise<void> {
  await db.transaction('rw', db.trades, db.balances, async () => {
    const prev = await db.trades.get(t.id);
    if (prev?.accountId && prev.cash) await adjustBalance(prev.accountId, -prev.cash, t.date);
    const next: Trade = { ...t, cash: undefined };
    if (t.accountId) {
      next.cash = tradeCash(t);
      await adjustBalance(t.accountId, next.cash, t.date);
    }
    await db.trades.put(next);
  });
}

export async function deleteTrade(id: string): Promise<void> {
  await db.transaction('rw', db.trades, db.balances, async () => {
    const t = await db.trades.get(id);
    if (!t) return;
    if (t.accountId && t.cash) await adjustBalance(t.accountId, -t.cash, t.date);
    await db.trades.delete(id);
  });
}

// ---------- 每日回報（沒交易／休市） ----------

const NO_TRADE_KEY = 'trade:noTrade';
const CLOSED_KEY = 'trade:closed';

async function getList(key: string): Promise<string[]> {
  return ((await db.kv.get(key))?.value as string[] | undefined) ?? [];
}

/** 標記某天沒有交易或休市，當天就不會再提醒 */
export async function markTradeDay(date: string, kind: 'noTrade' | 'closed'): Promise<void> {
  const key = kind === 'closed' ? CLOSED_KEY : NO_TRADE_KEY;
  const cur = await getList(key);
  if (!cur.includes(date)) await db.kv.put({ key, value: [...cur, date].sort().slice(-400) });
}

/** 已經回報過（有交易、沒交易或休市）的日期 */
export async function reportedTradeDays(): Promise<Set<string>> {
  const [a, b, trades] = await Promise.all([getList(NO_TRADE_KEY), getList(CLOSED_KEY), db.trades.toArray()]);
  return new Set([...a, ...b, ...trades.map((t) => t.date)]);
}

export async function closedDays(): Promise<Set<string>> {
  return new Set(await getList(CLOSED_KEY));
}
