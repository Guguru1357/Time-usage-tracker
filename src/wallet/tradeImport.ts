import { db, uid, type Trade } from '../db';
import { addDays } from '../time';
import { DEFAULT_USD_RATE, round2 } from './money';
import { analyzePositions, sortTrades } from './positions';

/**
 * 交易匯入檔（由 Claude 從券商 App 截圖整理）。
 * 範例：
 * {
 *   "app": "time-ledger-trades", "version": 1,
 *   "trades": [{ "date": "2026-11-03", "side": "buy", "market": "TW", "symbol": "2330", "name": "台積電",
 *                "price": 1000, "shares": 1000, "fee": 1425, "tax": 0 }],
 *   "holdings": [{ "market": "TW", "symbol": "2330", "name": "台積電", "shares": 1000, "avgCost": 1001.43 }]
 * }
 */
export const IMPORT_APP = 'time-ledger-trades';

export interface ImportRow {
  date: string;
  time?: string;
  side: 'buy' | 'sell';
  market: 'TW' | 'US';
  symbol: string;
  name?: string;
  price: number;
  shares: number;
  /** 手續費＋稅（原幣） */
  fee?: number;
  fx?: number;
  dca?: boolean;
  note?: string;
}

export interface ImportHolding {
  market: 'TW' | 'US';
  symbol: string;
  name?: string;
  shares: number;
  /** 平均成本（原幣、含手續費），補期初持股時用 */
  avgCost?: number;
}

export interface ParsedImport {
  rows: ImportRow[];
  holdings: ImportHolding[];
  /** 看不懂而略過的列，例如「第 3 筆：缺少成交價」 */
  errors: string[];
}

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function normDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = v.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function normSide(v: unknown): 'buy' | 'sell' | undefined {
  const s = String(v ?? '').trim().toLowerCase();
  if (['buy', 'b', '買', '買進', '買入', '現股買進'].includes(s)) return 'buy';
  if (['sell', 's', '賣', '賣出', '現股賣出'].includes(s)) return 'sell';
  return undefined;
}

/** 沒標示市場時：代號有英文字母（但不是台股 ETF 尾碼）就當美股 */
function normMarket(v: unknown, symbol: string): 'TW' | 'US' {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'US' || s === '美股') return 'US';
  if (s === 'TW' || s === '台股') return 'TW';
  return /^[A-Z.]+$/.test(symbol) ? 'US' : 'TW';
}

export function parseTradeImport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('檔案不是正確的 JSON');
  }
  const d = data as { app?: string; trades?: unknown[]; holdings?: unknown[] };
  if (!d || typeof d !== 'object' || (!Array.isArray(d.trades) && !Array.isArray(d.holdings))) {
    throw new Error('這不是交易匯入檔（需要 trades 或 holdings）');
  }
  const errors: string[] = [];
  const rows: ImportRow[] = [];
  (d.trades ?? []).forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const n = `第 ${i + 1} 筆`;
    const symbol = String(r.symbol ?? '').trim().toUpperCase();
    const date = normDate(r.date);
    const side = normSide(r.side);
    const price = num(r.price);
    const shares = num(r.shares);
    if (!date) return void errors.push(`${n}：日期看不懂（${String(r.date ?? '空白')}）`);
    if (!symbol) return void errors.push(`${n}：缺少股票代號`);
    if (!side) return void errors.push(`${n}（${symbol}）：看不出是買進還是賣出`);
    if (!price || price <= 0) return void errors.push(`${n}（${symbol}）：缺少成交價`);
    if (!shares || shares <= 0) return void errors.push(`${n}（${symbol}）：缺少股數`);
    const fee = (num(r.fee) ?? 0) + (num(r.tax) ?? 0);
    const market = normMarket(r.market, symbol);
    const time = typeof r.time === 'string' && /^\d{1,2}:\d{2}/.test(r.time) ? r.time.slice(0, 5).padStart(5, '0') : undefined;
    rows.push({
      date,
      time,
      side,
      market,
      symbol,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : undefined,
      price,
      shares,
      fee: fee > 0 ? round2(fee) : undefined,
      fx: market === 'US' ? num(r.fx) : undefined,
      dca: r.dca === true || undefined,
      note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined,
    });
  });
  const holdings: ImportHolding[] = [];
  (d.holdings ?? []).forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const symbol = String(r.symbol ?? '').trim().toUpperCase();
    const shares = num(r.shares);
    if (!symbol || shares === undefined || shares < 0) return void errors.push(`庫存第 ${i + 1} 筆：缺少代號或股數`);
    holdings.push({
      market: normMarket(r.market, symbol),
      symbol,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : undefined,
      shares,
      avgCost: num(r.avgCost),
    });
  });
  return { rows, holdings, errors };
}

function toTrade(r: ImportRow, now: number, usdRate: number): Trade {
  return {
    id: uid(),
    date: r.date,
    time: r.time,
    side: r.side,
    market: r.market === 'US' ? 'US' : undefined,
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    shares: r.shares,
    fee: r.fee,
    fx: r.market === 'US' ? (r.fx ?? usdRate) : undefined,
    dca: r.dca,
    reason: r.note,
    source: 'import',
    createdAt: now,
  };
}

export interface HoldingCheck {
  market: 'TW' | 'US';
  symbol: string;
  name?: string;
  /** 截圖上的庫存 */
  expected: number;
  /** 匯入的交易算出來的股數 */
  computed: number;
  avgCost?: number;
}

export interface ImportPlan {
  trades: Trade[];
  /** 截圖庫存和交易算出來不一樣的股票 */
  checks: HoldingCheck[];
  /** 用庫存補的期初持股（交易紀錄沒涵蓋到的部分） */
  opening: Trade[];
  from?: string;
  to?: string;
}

/**
 * 依匯入檔準備要寫入的交易。
 * 截圖通常只有最近幾個月，所以庫存比交易算出來的多時，可以在最早一筆交易的前一天補一筆「期初持股」。
 */
export function planImport(parsed: ParsedImport, usdRate = DEFAULT_USD_RATE, now = Date.now()): ImportPlan {
  const trades = sortTrades(parsed.rows.map((r) => toTrade(r, now, usdRate)));
  const from = trades[0]?.date;
  const to = trades[trades.length - 1]?.date;
  const computed = analyzePositions(trades).holdings;
  const key = (m: string, s: string) => `${m}:${s}`;
  const have = new Map(computed.map((h) => [key(h.market, h.symbol), h.shares]));

  const checks: HoldingCheck[] = [];
  const opening: Trade[] = [];
  const seen = new Set<string>();
  for (const h of parsed.holdings) {
    const k = key(h.market, h.symbol);
    seen.add(k);
    const c = have.get(k) ?? 0;
    if (Math.abs(c - h.shares) < 1e-6) continue;
    checks.push({ market: h.market, symbol: h.symbol, name: h.name, expected: h.shares, computed: c, avgCost: h.avgCost });
    if (h.shares > c && h.avgCost && h.avgCost > 0) {
      opening.push({
        id: uid(),
        date: from ? addDays(from, -1) : '2000-01-01',
        side: 'buy',
        market: h.market === 'US' ? 'US' : undefined,
        symbol: h.symbol,
        name: h.name,
        price: h.avgCost,
        shares: round2(h.shares - c),
        fx: h.market === 'US' ? usdRate : undefined,
        reason: '期初持股（依庫存截圖補上）',
        source: 'opening',
        createdAt: now - 1,
      });
    }
  }
  // 有提供庫存時：交易算出還有、但庫存截圖沒有的股票，也提醒
  if (parsed.holdings.length) {
    for (const h of computed) {
      if (!seen.has(key(h.market, h.symbol))) checks.push({ market: h.market, symbol: h.symbol, name: h.name, expected: 0, computed: h.shares });
    }
  }
  return { trades, checks, opening, from, to };
}

export interface ApplyOptions {
  /** 刪除 App 裡現有的所有交易（不還原交割戶餘額） */
  replace: boolean;
  /** 加入期初持股 */
  addOpening: boolean;
}

/**
 * 寫入匯入的交易。
 * 不同步任何帳戶餘額：歷史交易早就反映在目前的交割戶餘額裡，匯入後請照券商 App 更新一次餘額。
 * 不取代時，略過和現有紀錄完全相同的交易（日期、代號、買賣、價格、股數都一樣）。
 */
export async function applyImport(plan: ImportPlan, opts: ApplyOptions): Promise<{ added: number; skipped: number; removed: number }> {
  return db.transaction('rw', db.trades, async () => {
    let removed = 0;
    let existing: Trade[] = [];
    if (opts.replace) {
      removed = await db.trades.count();
      await db.trades.clear();
    } else {
      existing = await db.trades.toArray();
    }
    const sig = (t: Trade) => [t.date, t.market ?? 'TW', t.symbol, t.side, t.price, t.shares].join('|');
    const have = new Set(existing.map(sig));
    const list = [...(opts.addOpening ? plan.opening : []), ...plan.trades];
    const toAdd = list.filter((t) => !have.has(sig(t)));
    await db.trades.bulkAdd(toAdd);
    return { added: toAdd.length, skipped: list.length - toAdd.length, removed };
  });
}

/** 複製給 Claude 的說明：連同截圖一起貼上，請 Claude 產生匯入檔 */
export const CLAUDE_PROMPT = `請幫我把附上的券商 App 截圖（買賣紀錄、庫存）整理成一個 JSON 檔，讓我匯入「時間記帳」App。

格式（只輸出 JSON 檔，檔名例如 trades.json）：
{
  "app": "${IMPORT_APP}",
  "version": 1,
  "trades": [
    {
      "date": "2026-11-03",        // 成交日 YYYY-MM-DD
      "time": "09:15",             // 選填
      "side": "buy",               // buy 或 sell
      "market": "TW",              // TW 台股、US 美股
      "symbol": "2330",            // 代號；美股用英文代號，例如 AAPL
      "name": "台積電",             // 選填
      "price": 1000,               // 成交價（台股台幣、美股美元）
      "shares": 1000,              // 股數（1 張 = 1000 股；零股、美股可有小數）
      "fee": 1425,                 // 手續費（截圖上的實際金額，沒有填 0）
      "tax": 0,                    // 證交稅（賣出才有，沒有填 0）
      "fx": 32.4,                  // 美股才填：成交匯率；截圖沒有就省略
      "dca": false                 // 定期定額填 true
    }
  ],
  "holdings": [
    { "market": "TW", "symbol": "2330", "name": "台積電", "shares": 1000, "avgCost": 1001.43 }
  ]
}

規則：
1. trades 依截圖逐筆列出，不要合併；同一天同一檔分多筆成交就分多筆。
2. 手續費、證交稅請照截圖上的數字，不要自己估算；截圖上沒有的才填 0。
3. holdings 是截圖上「目前庫存」的股數和平均成本（含手續費的成本均價）。
4. 看不清楚的數字不要猜，在回覆中列出來讓我確認。
5. JSON 不要加註解（上面的 // 只是說明）。`;
