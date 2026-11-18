import type { HoldingSnapshot, Trade } from '../db';
import { DEFAULT_USD_RATE, round2 } from './money';

/** 美股以美元計價，交割時換算台幣；台股匯率為 1 */
export function tradeFx(t: Pick<Trade, 'market' | 'fx'>, usdRate = DEFAULT_USD_RATE): number {
  return t.market === 'US' ? (t.fx && t.fx > 0 ? t.fx : usdRate) : 1;
}

export function isUS(t: Pick<Trade, 'market'>): boolean {
  return t.market === 'US';
}

/** 成交金額（原幣：台股台幣、美股美元） */
export function tradeAmount(t: Pick<Trade, 'price' | 'shares'>): number {
  return t.price * t.shares;
}

/** 這筆交易對台幣交割戶的金額變動：買進付出（含手續費），賣出收入（扣手續費）；美股依匯率換算 */
export function tradeCash(t: Pick<Trade, 'side' | 'price' | 'shares' | 'fee' | 'market' | 'fx'>): number {
  const gross = t.price * t.shares;
  const fee = t.fee ?? 0;
  const native = t.side === 'buy' ? -(gross + fee) : gross - fee;
  // 和持股成本用同樣的精度，總資產才不會因為四捨五入差 1 元
  return round2(native * tradeFx(t));
}

export function sortTrades(list: Trade[]): Trade[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt - b.createdAt);
}

export interface Holding {
  symbol: string;
  name?: string;
  market: 'TW' | 'US';
  shares: number;
  /** 平均成本（原幣，含手續費） */
  avgCost: number;
  /** 持股成本（台幣） */
  costTWD: number;
}

type Pos = { symbol: string; market: 'TW' | 'US'; shares: number; cost: number; costTWD: number; name?: string };

/**
 * 以平均成本法計算持股與每筆賣出的已實現損益（台幣）。
 * 美股的成本和賣出收入都用當筆交易的匯率換成台幣，所以損益包含匯差。
 * 賣出股數超過持股時，只就持有的部分計算。start 是起始持股（例如庫存截圖）。
 */
export function analyzePositions(trades: Trade[], until?: string, start: Pos[] = []): { holdings: Holding[]; realized: Map<string, number> } {
  const pos = new Map<string, Pos>(start.map((p) => [`${p.market}:${p.symbol}`, { ...p }]));
  const realized = new Map<string, number>();
  for (const t of sortTrades(trades)) {
    if (until && t.date > until) continue;
    const market = isUS(t) ? 'US' : 'TW';
    const key = `${market}:${t.symbol}`;
    const p = pos.get(key) ?? { symbol: t.symbol, market, shares: 0, cost: 0, costTWD: 0 };
    if (t.name) p.name = t.name;
    const fee = t.fee ?? 0;
    const fx = tradeFx(t);
    if (t.side === 'buy') {
      p.cost += t.price * t.shares + fee;
      p.costTWD += (t.price * t.shares + fee) * fx;
      p.shares += t.shares;
    } else {
      const qty = Math.min(t.shares, p.shares);
      const avg = p.shares ? p.cost / p.shares : 0;
      const avgTWD = p.shares ? p.costTWD / p.shares : 0;
      realized.set(t.id, round2((t.price * qty - fee) * fx - avgTWD * qty));
      p.cost -= avg * qty;
      p.costTWD -= avgTWD * qty;
      p.shares = round2(p.shares - qty);
    }
    pos.set(key, p);
  }
  const holdings = [...pos.values()]
    .filter((p) => p.shares > 0)
    .map((p) => ({ symbol: p.symbol, name: p.name, market: p.market, shares: p.shares, avgCost: round2(p.cost / p.shares), costTWD: round2(p.costTWD) }));
  return { holdings, realized };
}

/** 庫存截圖之後才記的交易（手動補記的），要加在截圖的持股上 */
function afterSnapshot(t: Trade, snap: HoldingSnapshot): boolean {
  if (t.date > snap.date) return true;
  return t.date === snap.date && t.source !== 'import' && t.createdAt > snap.createdAt;
}

/**
 * 目前持股。
 * 有庫存截圖時以截圖為準（交易紀錄只是過程），再加上截圖之後手動記的交易；
 * 沒有截圖時才用全部交易推算。
 */
export function currentHoldings(trades: Trade[], snap?: HoldingSnapshot, usdRate = DEFAULT_USD_RATE, until?: string): Holding[] {
  if (!snap || (until && until < snap.date)) return analyzePositions(trades, until).holdings;
  const start: Pos[] = snap.items
    .filter((i) => i.shares > 0)
    .map((i) => {
      const cost = (i.avgCost ?? 0) * i.shares;
      return { symbol: i.symbol, market: i.market, name: i.name, shares: i.shares, cost, costTWD: cost * (i.market === 'US' ? usdRate : 1) };
    });
  return analyzePositions(
    trades.filter((t) => afterSnapshot(t, snap)),
    until,
    start,
  ).holdings;
}

/** 持股成本合計（台幣）；date 之前（含）；有庫存截圖時以截圖為準 */
export function holdingsCost(trades: Trade[], date?: string, snap?: HoldingSnapshot, usdRate = DEFAULT_USD_RATE): number {
  return round2(currentHoldings(trades, snap, usdRate, date).reduce((a, h) => a + h.costTWD, 0));
}

/** 最新的一張庫存截圖 */
export function latestSnapshot(list: HoldingSnapshot[] | undefined): HoldingSnapshot | undefined {
  return [...(list ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt).pop();
}
