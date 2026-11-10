import { db, normalizeAccountKind, uid, type Account, type AccountKind, type Balance, type Income, type Settings, type Trade } from '../db';
import { DEFAULT_USD_RATE, fmtTWD, round2 } from './money';

/** 常用外幣；符號用於顯示金額 */
export const CURRENCIES: { code: string; name: string; symbol: string; decimals: number }[] = [
  { code: 'TWD', name: '台幣', symbol: 'NT$', decimals: 0 },
  { code: 'USD', name: '美元', symbol: 'US$', decimals: 2 },
  { code: 'JPY', name: '日圓', symbol: 'JP¥', decimals: 0 },
  { code: 'EUR', name: '歐元', symbol: '€', decimals: 2 },
  { code: 'CNY', name: '人民幣', symbol: 'CN¥', decimals: 2 },
  { code: 'HKD', name: '港幣', symbol: 'HK$', decimals: 2 },
  { code: 'GBP', name: '英鎊', symbol: '£', decimals: 2 },
  { code: 'AUD', name: '澳幣', symbol: 'A$', decimals: 2 },
  { code: 'CAD', name: '加幣', symbol: 'C$', decimals: 2 },
  { code: 'SGD', name: '新加坡幣', symbol: 'S$', decimals: 2 },
  { code: 'KRW', name: '韓元', symbol: '₩', decimals: 0 },
];

export function currencyOf(a: Pick<Account, 'currency'>): string {
  return a.currency || 'TWD';
}

export function currencyInfo(code: string) {
  return CURRENCIES.find((c) => c.code === code) ?? { code, name: code, symbol: `${code} `, decimals: 2 };
}

/** 以該幣別顯示金額，例如 US$1,200.50、JP¥30,000 */
export function fmtMoney(amount: number, code: string): string {
  if (code === 'TWD') return fmtTWD(amount);
  const c = currencyInfo(code);
  return c.symbol + amount.toLocaleString('zh-TW', { maximumFractionDigits: c.decimals, minimumFractionDigits: 0 });
}

/** 1 單位外幣 = 多少台幣；沒設定時回傳 undefined（美元預設沿用訂閱的匯率） */
export function rateOf(code: string, settings: Pick<Settings, 'usdRate' | 'fxRates'>): number | undefined {
  if (code === 'TWD') return 1;
  if (code === 'USD') return settings.usdRate ?? DEFAULT_USD_RATE;
  const r = settings.fxRates?.[code];
  return r && r > 0 ? r : undefined;
}

export async function setRate(code: string, rate: number, date: string): Promise<void> {
  const cur = (await db.settings.get('main'))!;
  if (code === 'USD') await db.settings.put({ ...cur, usdRate: rate, fxUpdated: date });
  else await db.settings.put({ ...cur, fxRates: { ...cur.fxRates, [code]: rate }, fxUpdated: date });
}

export const ACCOUNT_KINDS: Record<AccountKind, string> = {
  deposit: '綜合存款',
  broker: '證券',
  foreign: '外幣',
};

export const ACCOUNT_KIND_ORDER: AccountKind[] = ['deposit', 'broker', 'foreign'];

/** 帳戶分類（舊資料可能還是郵局、銀行等舊類型） */
export function accountKind(a: Pick<Account, 'kind' | 'currency'>): AccountKind {
  return normalizeAccountKind(a.kind, a.currency);
}

/** 持股成本（平均成本 × 股數），date 之前（含）的交易 */
export function holdingsCost(trades: Trade[], date?: string): number {
  const pos = new Map<string, { shares: number; cost: number }>();
  const list = [...trades]
    .filter((t) => !date || t.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt - b.createdAt);
  for (const t of list) {
    const p = pos.get(t.symbol) ?? { shares: 0, cost: 0 };
    if (t.side === 'buy') {
      p.cost += t.price * t.shares + (t.fee ?? 0);
      p.shares += t.shares;
    } else {
      const qty = Math.min(t.shares, p.shares);
      const avg = p.shares ? p.cost / p.shares : 0;
      p.cost -= avg * qty;
      p.shares -= qty;
    }
    pos.set(t.symbol, p);
  }
  return round2([...pos.values()].reduce((a, p) => a + (p.shares > 0 ? p.cost : 0), 0));
}

/**
 * 新餘額紀錄的建立時間：一定比這個帳戶最新的一筆晚。
 * 同一毫秒內連續寫入（例如編輯交易時先還原再扣款）也能分出先後。
 */
function nextStamp(latest: Balance | undefined): number {
  return Math.max(Date.now(), (latest?.createdAt ?? 0) + 1);
}

async function latestOf(accountId: string): Promise<Balance | undefined> {
  return balancesAt(await db.balances.where('accountId').equals(accountId).toArray()).get(accountId);
}

/** 調整帳戶餘額：在最新一筆餘額上加減，日期不早於最新那筆 */
export async function adjustBalance(accountId: string, delta: number, date: string): Promise<void> {
  if (!delta) return;
  const cur = await latestOf(accountId);
  await db.balances.add({
    id: uid(),
    accountId,
    amount: round2((cur?.amount ?? 0) + delta),
    date: cur && cur.date > date ? cur.date : date,
    createdAt: nextStamp(cur),
  });
}

export const INCOME_KINDS: Record<Income['kind'], string> = {
  salary: '薪資',
  bonus: '獎金',
  other: '其他收入',
};

function newer(a: Balance, b: Balance): boolean {
  return a.date > b.date || (a.date === b.date && a.createdAt > b.createdAt);
}

/** 每個帳戶在 date（含）以前最新的一筆餘額 */
export function balancesAt(balances: Balance[], date?: string): Map<string, Balance> {
  const out = new Map<string, Balance>();
  for (const b of balances) {
    if (date && b.date > date) continue;
    const cur = out.get(b.accountId);
    if (!cur || newer(b, cur)) out.set(b.accountId, b);
  }
  return out;
}

export interface AssetTotal {
  /** 換算成台幣的總額 */
  twd: number;
  /** 還沒設定匯率、沒算進總額的幣別 */
  missing: string[];
}

/** 所有帳戶換算台幣的總額（使用目前匯率） */
export function totalAt(accounts: Account[], balances: Balance[], rates: (code: string) => number | undefined, date?: string): AssetTotal {
  const byId = new Map(accounts.filter((a) => !a.archived).map((a) => [a.id, a]));
  let sum = 0;
  const missing = new Set<string>();
  for (const [id, b] of balancesAt(balances, date)) {
    const a = byId.get(id);
    if (!a) continue;
    const r = rates(currencyOf(a));
    if (r === undefined) missing.add(currencyOf(a));
    else sum += b.amount * r;
  }
  return { twd: round2(sum), missing: [...missing] };
}

export async function saveAccount(a: Omit<Account, 'id' | 'order'> & { id?: string }): Promise<string> {
  if (a.id) {
    const { id, ...rest } = a;
    await db.accounts.update(id, rest);
    return id;
  }
  const max = await db.accounts.orderBy('order').last();
  const id = uid();
  await db.accounts.add({ ...a, id, order: (max?.order ?? -1) + 1 });
  return id;
}

export async function setBalance(accountId: string, amount: number, date: string): Promise<void> {
  await db.balances.add({ id: uid(), accountId, amount: round2(amount), date, createdAt: nextStamp(await latestOf(accountId)) });
}

/** 新增收入；指定帳戶時一併把金額加到該帳戶餘額 */
export async function addIncome(data: Omit<Income, 'id'>, addToAccount: boolean): Promise<void> {
  await db.transaction('rw', db.incomes, db.balances, async () => {
    await db.incomes.add({ ...data, id: uid(), amount: round2(data.amount) });
    if (addToAccount && data.accountId) {
      const cur = await latestOf(data.accountId);
      await db.balances.add({ id: uid(), accountId: data.accountId, amount: round2((cur?.amount ?? 0) + data.amount), date: data.date, createdAt: nextStamp(cur) });
    }
  });
}

export function salaryInMonth(incomes: Income[], month: string): Income[] {
  return incomes.filter((i) => i.kind === 'salary' && i.date.startsWith(month));
}
