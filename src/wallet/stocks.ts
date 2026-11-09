import { db, type Emotion, type Trade } from '../db';
import { addDays, dayStart } from '../time';
import { round2 } from './money';

export const EMOTIONS: Record<Emotion, { label: string; hint: string }> = {
  calm: { label: '平靜', hint: '照自己的節奏' },
  fomo: { label: '怕錯過', hint: '看到大漲想追' },
  fear: { label: '恐懼', hint: '怕跌、想先跑' },
  greed: { label: '貪心', hint: '想多賺一點' },
  revenge: { label: '想翻本', hint: '剛賠錢想拿回來' },
  bored: { label: '無聊', hint: '沒事做想動一下' },
  impulse: { label: '衝動', hint: '沒想太多' },
};

export const EMOTION_ORDER: Emotion[] = ['calm', 'fomo', 'fear', 'greed', 'revenge', 'bored', 'impulse'];

export function tradeAmount(t: Trade): number {
  return t.price * t.shares;
}

export function sortTrades(list: Trade[]): Trade[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt - b.createdAt);
}

export interface Holding {
  symbol: string;
  name?: string;
  shares: number;
  /** 平均成本（含手續費） */
  avgCost: number;
}

/**
 * 以平均成本法計算持股與每筆賣出的已實現損益。
 * 賣出股數超過持股時，只就持有的部分計算。
 */
export function analyzePositions(trades: Trade[]): { holdings: Holding[]; realized: Map<string, number> } {
  const pos = new Map<string, { shares: number; cost: number; name?: string }>();
  const realized = new Map<string, number>();
  for (const t of sortTrades(trades)) {
    const p = pos.get(t.symbol) ?? { shares: 0, cost: 0 };
    if (t.name) p.name = t.name;
    const fee = t.fee ?? 0;
    if (t.side === 'buy') {
      p.cost += t.price * t.shares + fee;
      p.shares += t.shares;
    } else {
      const qty = Math.min(t.shares, p.shares);
      const avg = p.shares ? p.cost / p.shares : 0;
      realized.set(t.id, round2(t.price * qty - fee - avg * qty));
      p.cost -= avg * qty;
      p.shares -= qty;
    }
    pos.set(t.symbol, p);
  }
  const holdings = [...pos.entries()]
    .filter(([, p]) => p.shares > 0)
    .map(([symbol, p]) => ({ symbol, name: p.name, shares: p.shares, avgCost: round2(p.cost / p.shares) }));
  return { holdings, realized };
}

export interface Warning {
  level: 'high' | 'mid';
  text: string;
}

export interface TradeReport {
  count: number;
  tradingDays: number;
  maxPerDay: number;
  unplanned: number;
  emotional: number;
  emotions: Map<Emotion, { count: number; pnl: number; sells: number }>;
  plannedPnl: number;
  unplannedPnl: number;
  warnings: Warning[];
}

/** 期間 [from, to] 內的交易行為檢查 */
export function tradeReport(all: Trade[], from: string, to: string): TradeReport {
  const { realized } = analyzePositions(all);
  const list = sortTrades(all).filter((t) => t.date >= from && t.date <= to);
  const perDay = new Map<string, number>();
  for (const t of list) perDay.set(t.date, (perDay.get(t.date) ?? 0) + 1);

  const emotions = new Map<Emotion, { count: number; pnl: number; sells: number }>();
  let plannedPnl = 0;
  let unplannedPnl = 0;
  for (const t of list) {
    const e = emotions.get(t.emotion) ?? { count: 0, pnl: 0, sells: 0 };
    e.count++;
    const r = realized.get(t.id);
    if (r !== undefined) {
      e.pnl += r;
      e.sells++;
      if (t.planned) plannedPnl += r;
      else unplannedPnl += r;
    }
    emotions.set(t.emotion, e);
  }

  const count = list.length;
  const unplanned = list.filter((t) => !t.planned).length;
  const emotional = list.filter((t) => t.emotion !== 'calm').length;
  const maxPerDay = Math.max(0, ...perDay.values());
  const warnings: Warning[] = [];

  // 單日交易太多
  const busyDays = [...perDay.values()].filter((n) => n >= 4).length;
  if (busyDays) warnings.push({ level: 'high', text: `有 ${busyDays} 天單日交易 4 筆以上，可能過度交易` });

  // 連續多天都在交易
  let run = 0;
  let maxRun = 0;
  let prev = '';
  for (const d of [...perDay.keys()].sort()) {
    run = prev && nextWeekday(prev) === d ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
    prev = d;
  }
  if (maxRun >= 5) warnings.push({ level: 'mid', text: `連續 ${maxRun} 個交易日都有進出` });

  // 賠錢賣出後 1 天內又買進
  let revenge = 0;
  for (const t of list) {
    if (t.side !== 'sell' || (realized.get(t.id) ?? 0) >= 0) continue;
    const limit = addDays(t.date, 1);
    if (list.some((b) => b.side === 'buy' && b.date >= t.date && b.date <= limit && sortTrades([t, b])[0] === t && b.id !== t.id)) revenge++;
  }
  if (revenge) warnings.push({ level: 'high', text: `${revenge} 次賠錢賣出後一天內又買進（想翻本？）` });

  // 短進短出：買進後 3 天內賣出同一檔
  let flips = 0;
  for (const s of list) {
    if (s.side !== 'sell') continue;
    if (list.some((b) => b.side === 'buy' && b.symbol === s.symbol && b.date <= s.date && b.date >= addDays(s.date, -3))) flips++;
  }
  if (flips >= 2) warnings.push({ level: 'mid', text: `${flips} 次買進後 3 天內就賣出（短進短出）` });

  if (count >= 3 && unplanned / count > 0.4) warnings.push({ level: 'high', text: `${Math.round((unplanned / count) * 100)}% 的交易不在計畫內` });
  if (count >= 3 && emotional / count > 0.5) warnings.push({ level: 'mid', text: `${Math.round((emotional / count) * 100)}% 的交易帶著情緒` });

  return { count, tradingDays: perDay.size, maxPerDay, unplanned, emotional, emotions, plannedPnl: round2(plannedPnl), unplannedPnl: round2(unplannedPnl), warnings };
}

function nextWeekday(date: string): string {
  let d = addDays(date, 1);
  while ([0, 6].includes(new Date(dayStart(d)).getDay())) d = addDays(d, 1);
  return d;
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
