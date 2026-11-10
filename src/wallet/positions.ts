import type { Trade } from '../db';
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

/**
 * 以平均成本法計算持股與每筆賣出的已實現損益（台幣）。
 * 美股的成本和賣出收入都用當筆交易的匯率換成台幣，所以損益包含匯差。
 * 賣出股數超過持股時，只就持有的部分計算。
 */
export function analyzePositions(trades: Trade[], until?: string): { holdings: Holding[]; realized: Map<string, number> } {
  const pos = new Map<string, { symbol: string; market: 'TW' | 'US'; shares: number; cost: number; costTWD: number; name?: string }>();
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

/** 持股成本合計（台幣），date 之前（含）的交易 */
export function holdingsCost(trades: Trade[], date?: string): number {
  return round2(analyzePositions(trades, date).holdings.reduce((a, h) => a + h.costTWD, 0));
}
