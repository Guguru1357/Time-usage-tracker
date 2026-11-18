import { db, uid, type HoldingSnapshot, type Trade } from '../db';
import { todayKey } from '../time';
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
  /** 當沖 */
  daytrade?: boolean;
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
  /** 檔案有 holdings 欄位（就算是空的，也代表目前沒有持股） */
  holdingsProvided: boolean;
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

/**
 * 買賣別：buy/sell，或券商 App 上的中文（買進、現股賣出、沖買、沖賣、現沖買、當沖賣出、融資買進、融券賣出…）。
 * 「沖」代表當沖。
 */
function normSide(v: unknown): { side?: 'buy' | 'sell'; daytrade: boolean } {
  const s = String(v ?? '').replace(/\s/g, '').toLowerCase();
  const daytrade = s.includes('沖');
  if (['buy', 'b'].includes(s) || (s.includes('買') && !s.includes('賣'))) return { side: 'buy', daytrade };
  if (['sell', 's'].includes(s) || (s.includes('賣') && !s.includes('買'))) return { side: 'sell', daytrade };
  return { daytrade };
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
    const { side, daytrade } = normSide(r.side);
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
      daytrade: r.daytrade === true || daytrade || undefined,
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
  return { rows, holdings, holdingsProvided: Array.isArray(d.holdings), errors };
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
    reason: [r.daytrade ? '當沖' : '', r.note ?? ''].filter(Boolean).join(' · ') || undefined,
    source: 'import',
    createdAt: now,
  };
}

export interface ImportPlan {
  trades: Trade[];
  /** 庫存截圖；檔案沒有 holdings 欄位時為 undefined */
  holdings?: ImportHolding[];
  from?: string;
  to?: string;
}

/** 持股：key 為 `${market}:${symbol}`，值為股數 */
export type Positions = Map<string, number>;

const posKey = (market: string, symbol: string) => `${market}:${symbol}`;

/**
 * 檔案開始的月份之前，App 裡已經有的持股（「月初持有」）。
 * 跨月的買賣（例如 10 月買、11 月賣）要先算進來，核對才不會誤判。
 * 選「取代全部交易」時舊紀錄會被刪掉，就沒有月初持有。
 */
export function priorPositions(existing: Trade[], parsed: ParsedImport, mode: ReplaceMode): Positions {
  const months = parsed.rows.map((r) => r.date.slice(0, 7)).sort();
  if (mode === 'all' || !months.length) return new Map();
  const start = `${months[0]}-01`;
  const before = existing.filter((t) => t.date < start);
  return new Map(analyzePositions(before).holdings.map((h) => [posKey(h.market, h.symbol), h.shares]));
}

/** 依匯入檔準備要寫入的交易與庫存截圖 */
export function planImport(parsed: ParsedImport, usdRate = DEFAULT_USD_RATE, now = Date.now()): ImportPlan {
  const trades = sortTrades(parsed.rows.map((r) => toTrade(r, now, usdRate)));
  return {
    trades,
    holdings: parsed.holdingsProvided ? parsed.holdings : undefined,
    from: trades[0]?.date,
    to: trades[trades.length - 1]?.date,
  };
}

export interface SymbolSummary {
  market: 'TW' | 'US';
  symbol: string;
  name?: string;
  /** 檔案開始的月份之前，App 裡已經持有的股數（跨月買賣用） */
  prior: number;
  bought: number;
  sold: number;
  /** 檔案裡的交易造成的增減（買 − 賣） */
  net: number;
  /** 庫存截圖上的股數；庫存沒有這檔時為 0，沒提供庫存時為 undefined */
  holding?: number;
  /** 同一天買賣同樣股數（當沖、已平倉）的日期 */
  dayTradeDates: string[];
  /**
   * ok：月初持有＋買−賣＝庫存
   * older：庫存比較多（可能是更早買的）
   * soldEarlier：賣掉的比 App 裡有的還多（賣出更早買的股票，但 App 沒有那時的買進紀錄），庫存也對得上
   * mismatch：算出來比庫存多、或當沖卻出現在庫存，多半是讀錯或漏列
   */
  status: 'ok' | 'older' | 'soldEarlier' | 'mismatch' | 'unknown';
}

/** 依股票整理：買了多少、賣了多少、和庫存截圖是否對得上 */
export function summarizeBySymbol(parsed: ParsedImport, prior: Positions = new Map()): SymbolSummary[] {
  const map = new Map<string, SymbolSummary>();
  const key = posKey;
  const get = (market: 'TW' | 'US', symbol: string, name?: string) => {
    const k = key(market, symbol);
    let x = map.get(k);
    if (!x) {
      x = { market, symbol, name, prior: prior.get(k) ?? 0, bought: 0, sold: 0, net: 0, dayTradeDates: [], status: 'unknown' };
      map.set(k, x);
    }
    if (name && !x.name) x.name = name;
    return x;
  };
  const perDay = new Map<string, { buy: number; sell: number }>();
  for (const r of parsed.rows) {
    const x = get(r.market, r.symbol, r.name);
    if (r.side === 'buy') x.bought = round2(x.bought + r.shares);
    else x.sold = round2(x.sold + r.shares);
    const dk = `${key(r.market, r.symbol)}|${r.date}`;
    const d = perDay.get(dk) ?? { buy: 0, sell: 0 };
    d[r.side] = round2(d[r.side] + r.shares);
    perDay.set(dk, d);
  }
  for (const [dk, d] of perDay) {
    if (d.buy > 0 && d.buy === d.sell) map.get(dk.split('|')[0])!.dayTradeDates.push(dk.split('|')[1]);
  }
  const hasHoldings = parsed.holdingsProvided;
  for (const h of parsed.holdings) get(h.market, h.symbol, h.name).holding = h.shares;
  // 月初就持有、這段期間沒交易的股票也要核對（例如 10 月買的，11 月庫存應該還在）
  if (hasHoldings) {
    for (const [k, shares] of prior) {
      if (shares > 0 && !map.has(k)) {
        const [market, symbol] = k.split(':') as ['TW' | 'US', string];
        get(market, symbol);
      }
    }
  }
  for (const x of map.values()) {
    x.net = round2(x.bought - x.sold);
    if (!hasHoldings) continue;
    x.holding ??= 0;
    // 月初持有 + 買 − 賣 應該等於庫存
    const end = round2(x.prior + x.net);
    // 只有當沖（買賣都在同一天平倉）、月初也沒持有，卻出現在庫存裡，幾乎都是把當沖誤判成持股
    const onlyClosedDayTrades = x.prior === 0 && x.dayTradeDates.length > 0 && x.net === 0;
    if (Math.abs(end - x.holding) < 1e-6) x.status = 'ok';
    else if (onlyClosedDayTrades) x.status = 'mismatch';
    else if (end < 0 && x.holding === 0) x.status = 'soldEarlier';
    else if (x.holding > end && end >= 0) x.status = 'older';
    else x.status = 'mismatch';
  }
  return [...map.values()].sort((a, b) => Number(b.status === 'mismatch') - Number(a.status === 'mismatch') || a.symbol.localeCompare(b.symbol));
}

/** 不一致的清單，方便貼回 Claude App 請它重新核對 */
export function mismatchReport(list: SymbolSummary[]): string {
  const bad = list.filter((x) => x.status === 'mismatch' || x.status === 'older');
  if (!bad.length) return '';
  const lines = bad.map(
    (x) =>
      `- ${x.symbol}${x.name ? ` ${x.name}` : ''}：${x.prior ? `月初已持有 ${x.prior} 股（之前的月份買的），` : ''}交易明細 買 ${x.bought} 股、賣 ${x.sold} 股（淨 ${x.net >= 0 ? '+' : ''}${x.net}），庫存截圖 ${x.holding ?? 0} 股`,
  );
  return `你整理的檔案裡，下面這幾檔的交易和庫存對不起來，請對照截圖重新檢查（特別是當沖的買賣是否兩邊都有列、是否把已賣掉的股票放進庫存），修正後重新給我完整的 JSON 檔：\n${lines.join('\n')}`;
}

/**
 * months：刪掉檔案涵蓋的月份裡所有現有交易，再換成檔案的（其他月份不動）
 * all：刪掉所有現有交易
 * append：不刪，只加入檔案裡新的交易
 */
export type ReplaceMode = 'months' | 'all' | 'append';

export interface ApplyOptions {
  mode: ReplaceMode;
}

/** 檔案涵蓋的月份（YYYY-MM），由舊到新 */
export function monthsOf(plan: ImportPlan): string[] {
  return [...new Set(plan.trades.map((t) => t.date.slice(0, 7)))].sort();
}

/**
 * 寫入匯入的交易，並把庫存截圖存成目前持股。
 * 不同步任何帳戶餘額，刪掉的舊交易也不還原：過去的交易早就反映在目前的交割戶餘額裡，
 * 匯入後請照券商 App 更新一次餘額。
 * 加入時一律略過和留下來的紀錄完全相同的交易（日期、代號、買賣、價格、股數都一樣）。
 */
export async function applyImport(
  plan: ImportPlan,
  opts: ApplyOptions,
  date = todayKey(),
): Promise<{ added: number; skipped: number; removed: number; snapshot: boolean }> {
  return db.transaction('rw', db.trades, db.holdingSnapshots, async () => {
    const all = await db.trades.toArray();
    const months = new Set(monthsOf(plan));
    const remove = opts.mode === 'all' ? all : opts.mode === 'months' ? all.filter((t) => months.has(t.date.slice(0, 7))) : [];
    await db.trades.bulkDelete(remove.map((t) => t.id));
    const removedIds = new Set(remove.map((t) => t.id));
    const kept = all.filter((t) => !removedIds.has(t.id));

    const sig = (t: Trade) => [t.date, t.market ?? 'TW', t.symbol, t.side, t.price, t.shares].join('|');
    const have = new Set(kept.map(sig));
    const toAdd = plan.trades.filter((t) => !have.has(sig(t)));
    await db.trades.bulkAdd(toAdd);
    // 庫存截圖是「現在有的」持股，之後的持股以它為準
    if (plan.holdings) {
      const snap: HoldingSnapshot = {
        id: uid(),
        date,
        createdAt: Date.now(),
        items: plan.holdings.map((h) => ({ market: h.market, symbol: h.symbol, name: h.name, shares: h.shares, avgCost: h.avgCost })),
      };
      await db.holdingSnapshots.put(snap);
    }
    return { added: toAdd.length, skipped: plan.trades.length - toAdd.length, removed: remove.length, snapshot: !!plan.holdings };
  });
}

/** 複製給 Claude 的說明：連同截圖一起貼上，請 Claude 產生匯入檔 */
export const CLAUDE_PROMPT = `請幫我把附上的券商 App 截圖整理成一個 JSON 檔，讓我匯入「時間記帳」App。
截圖有兩種，用途不同：
- 「交易明細／成交回報」：買賣的「過程」，我拿來檢視自己的操作。
- 「庫存」：「現在有的」股票。App 的持股完全以庫存為準，不會用交易去推算。

【最重要的規則】
1. trades 只能來自「交易明細」截圖，逐筆照抄，不要合併、不要省略。
2. holdings 只能來自「庫存」截圖。庫存截圖上沒有的股票，就不要放進 holdings；不要自己從交易推算庫存。
3. 當沖（現股當沖、沖買、沖賣、現沖）：同一天的買進和賣出兩筆都要列出，兩筆都加 "daytrade": true。當沖買賣同樣張數代表當天已平倉，不會留在庫存。
4. 手續費、證交稅照截圖上的數字填，不要自己估算；截圖上沒有才填 0。
5. 單位：1 張 = 1000 股，shares 一律填「股數」（2 張填 2000，零股照實際股數）。
6. 跨月的買賣：這個月的明細裡可能有「賣出之前月份買的股票」，照截圖列出賣出那筆就好，不要自己補一筆買進，也不要把它改到別的月份；這種情況賣出比買進多是正常的。
7. 看不清楚的數字不要猜，在回覆裡列出來問我。

【輸出前請自我檢查】
對每一檔股票算「交易明細的買進股數 − 賣出股數」，和庫存截圖的股數比較：
- 一樣，或庫存比較多（代表是更早之前買的）→ 正常。
- 賣出比買進多：如果是賣掉之前月份買的股票，屬於正常，照實列出就好。
- 當天沖銷（同一天買賣同樣股數）的股票，庫存截圖上不應該出現；出現的話請再確認庫存截圖。
- 交易算出來比庫存多 → 一定有讀錯或漏列，請重新看截圖修正；修正不了就在回覆裡列出來，不要為了湊數字改資料。
最後在回覆中用一句話列出每檔的檢查結果。

【格式】只輸出一個 JSON 檔（檔名例如 trades.json），不要加註解：
{
  "app": "${IMPORT_APP}",
  "version": 1,
  "trades": [
    { "date": "2026-11-02", "time": "09:05", "side": "buy", "market": "TW", "symbol": "6274", "name": "台燿",
      "price": 400, "shares": 1000, "fee": 570, "tax": 0, "daytrade": true },
    { "date": "2026-11-02", "time": "13:10", "side": "sell", "market": "TW", "symbol": "6274", "name": "台燿",
      "price": 410, "shares": 1000, "fee": 584, "tax": 615, "daytrade": true }
  ],
  "holdings": [
    { "market": "TW", "symbol": "2330", "name": "台積電", "shares": 1000, "avgCost": 1001.43 }
  ]
}
欄位說明：date 成交日 YYYY-MM-DD；time 選填；side 為 buy 或 sell；market 台股 TW、美股 US；
symbol 代號（美股用英文代號）；price 成交價（台股台幣、美股美元）；fee 手續費；tax 證交稅（賣出才有）；
美股可加 "fx" 成交匯率；定期定額加 "dca": true；holdings 的 avgCost 是庫存上含手續費的成本均價。`;
