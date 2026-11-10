import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, restoreBackup } from '../src/backup';
import { db, normalizeAccountKind, type Subscription, type Trade } from '../src/db';
import { ensureSeeded } from '../src/defaults';
import { salaryReminderTimes, tradeReminderTimes } from '../src/notifications';
import { HOUR, MIN, dayStart } from '../src/time';
import { addIncome, balancesAt, deleteTransfer, fmtMoney, holdingsCost, rateOf, saveAccount, saveTransfer, setBalance, totalAt } from '../src/wallet/assets';
import { importPwaBackup } from '../src/wallet/importPwa';
import { addGiftLog, giftBalance, giftCount, monthlyTWD, nextCharge } from '../src/wallet/money';
import { deleteExpense, saveExpense } from '../src/wallet/expenses';
import { analyzePositions, dailyCounts, deleteTrade, saveTrade, tradeReport, weeklyCounts } from '../src/wallet/stocks';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

let n = 0;
const trade = (t: Partial<Trade>): Trade => ({
  id: `t${++n}`,
  date: '2026-11-02',
  side: 'buy',
  symbol: '2330',
  price: 100,
  shares: 1000,
  createdAt: n,
  ...t,
});

describe('stocks', () => {
  it('computes realized P&L with average cost', () => {
    const a = trade({ price: 100 });
    const b = trade({ price: 120, date: '2026-11-03' });
    const s = trade({ side: 'sell', price: 130, shares: 1000, date: '2026-11-04' });
    const { holdings, realized } = analyzePositions([s, b, a]);
    expect(realized.get(s.id)).toBe(20_000);
    expect(holdings).toEqual([{ symbol: '2330', name: undefined, shares: 1000, avgCost: 110 }]);
  });

  it('summarises trades, DCA and realized P&L for a period', () => {
    const list = [
      trade({ date: '2026-11-02', price: 100 }),
      trade({ date: '2026-11-03', side: 'sell', price: 90 }),
      trade({ date: '2026-11-03', price: 95 }),
      trade({ date: '2026-11-06', symbol: '0050', price: 190, shares: 15, dca: true }),
    ];
    expect(tradeReport(list, '2026-10-10', '2026-11-08')).toEqual({ count: 4, tradingDays: 3, dca: 1, realized: -10_000 });
    // 定期定額照樣算進持股
    expect(analyzePositions(list).holdings.find((h) => h.symbol === '0050')?.shares).toBe(15);
  });

  it('counts trades per day', () => {
    const d = dailyCounts([trade({ date: '2026-11-09' }), trade({ date: '2026-11-09' }), trade({ date: '2026-11-07' })], '2026-11-09', 3);
    expect(d).toEqual([
      { date: '2026-11-07', count: 1 },
      { date: '2026-11-08', count: 0 },
      { date: '2026-11-09', count: 2 },
    ]);
  });

  it('counts trades per week ending at the given date', () => {
    const w = weeklyCounts([trade({ date: '2026-11-02' }), trade({ date: '2026-11-08' }), trade({ date: '2026-10-30' })], '2026-11-09', 2);
    expect(w).toEqual([
      { start: '2026-11-02', count: 2 },
      { start: '2026-11-09', count: 0 },
    ]);
  });
});

describe('reminders', () => {
  it('reminds on weekdays at 14:00, skipping reported days and the past', () => {
    // 2026-11-09 是週一；現在 15:00，今天已過
    const now = dayStart('2026-11-09') + 15 * HOUR;
    const out = tradeReminderTimes('2026-11-09', '14:00', new Set(['2026-11-11']), now, 7);
    expect(out.map((x) => x.date)).toEqual(['2026-11-10', '2026-11-12', '2026-11-13']);
    expect(out[0].at).toBe(dayStart('2026-11-10') + 14 * HOUR);
  });

  it('reminds about salary on the 7th unless already recorded that month', () => {
    const now = dayStart('2026-11-05');
    expect(salaryReminderTimes('2026-11-05', 7, new Set(), now).map((x) => x.month)).toEqual(['2026-11', '2026-12']);
    const out = salaryReminderTimes('2026-11-05', 7, new Set(['2026-11']), now);
    expect(out.map((x) => x.month)).toEqual(['2026-12']);
    expect(out[0].at).toBe(dayStart('2026-12-07') + 20 * HOUR + 0 * MIN);
  });
});

describe('assets', () => {
  it('sums the latest balance of each account, and salary can top up an account', async () => {
    const post = await saveAccount({ name: '郵局', kind: 'deposit' });
    const bank = await saveAccount({ name: '國泰', kind: 'deposit' });
    await setBalance(post, 50_000, '2026-10-31');
    await setBalance(bank, 20_000, '2026-10-31');
    await addIncome({ date: '2026-11-07', amount: 40_000, kind: 'salary', accountId: bank }, true);
    const [accounts, balances] = [await db.accounts.toArray(), await db.balances.toArray()];
    const twdOnly = (c: string) => (c === 'TWD' ? 1 : undefined);
    expect(totalAt(accounts, balances, twdOnly, '2026-10-31').twd).toBe(70_000);
    expect(totalAt(accounts, balances, twdOnly).twd).toBe(110_000);
  });

  it('converts foreign currency accounts and reports currencies without a rate', async () => {
    const usd = await saveAccount({ name: '國泰 美元', kind: 'foreign', currency: 'USD' });
    const jpy = await saveAccount({ name: '日圓帳戶', kind: 'foreign', currency: 'JPY' });
    await setBalance(usd, 1000, '2026-11-01');
    await setBalance(jpy, 50_000, '2026-11-01');
    const [accounts, balances] = [await db.accounts.toArray(), await db.balances.toArray()];
    const settings = { usdRate: 32.5, fxRates: {} as Record<string, number> };
    expect(totalAt(accounts, balances, (c) => rateOf(c, settings))).toEqual({ twd: 32_500, missing: ['JPY'] });
    settings.fxRates.JPY = 0.21;
    expect(totalAt(accounts, balances, (c) => rateOf(c, settings))).toEqual({ twd: 43_000, missing: [] });
    expect(fmtMoney(1234.5, 'USD')).toBe('US$1,234.5');
    expect(fmtMoney(50000, 'JPY')).toBe('JP¥50,000');
  });
});

describe('stock ↔ broker account sync', () => {
  it('moves cash on buy/sell, and reverts on edit and delete', async () => {
    // 固定時間：模擬同一毫秒內連續寫入多筆餘額（CI 上曾因此算錯）
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const broker = await saveAccount({ name: '元大交割戶', kind: 'broker' });
    await setBalance(broker, 200_000, '2026-11-01');
    const bal = async () => balancesAt(await db.balances.toArray()).get(broker)!.amount;

    const buy = trade({ date: '2026-11-03', price: 100, shares: 1000, fee: 142, accountId: broker });
    await saveTrade(buy);
    expect(await bal()).toBe(200_000 - 100_142);
    // 改價格：先還原再重新扣
    await saveTrade({ ...buy, price: 110 });
    expect(await bal()).toBe(200_000 - 110_142);
    const sell = trade({ date: '2026-11-05', side: 'sell', price: 120, shares: 1000, fee: 500, accountId: broker });
    await saveTrade(sell);
    expect(await bal()).toBe(200_000 - 110_142 + 119_500);
    // 改成不同步、刪除
    await saveTrade({ ...sell, accountId: undefined });
    expect(await bal()).toBe(200_000 - 110_142);
    await deleteTrade(buy.id);
    expect(await bal()).toBe(200_000);
    clock.mockRestore();
  });

  it('counts stock holdings at cost', () => {
    const list = [trade({ price: 100, shares: 2000, fee: 200 }), trade({ side: 'sell', price: 150, shares: 1000, date: '2026-11-04' })];
    expect(holdingsCost(list)).toBe(100_100);
    expect(holdingsCost(list, '2026-11-02')).toBe(200_200);
  });

  it('maps old account types to the new categories', () => {
    expect(normalizeAccountKind('post')).toBe('deposit');
    expect(normalizeAccountKind('bank', 'USD')).toBe('foreign');
    expect(normalizeAccountKind('broker')).toBe('broker');
  });
});

describe('transfers', () => {
  it('moves money between accounts, and reverts on edit and delete', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const salary = await saveAccount({ name: '合庫薪轉戶', kind: 'deposit' });
    const broker = await saveAccount({ name: '元大交割戶', kind: 'broker' });
    const usd = await saveAccount({ name: '美元帳戶', kind: 'foreign', currency: 'USD' });
    await setBalance(salary, 300_000, '2026-11-01');
    await setBalance(broker, 5_000, '2026-11-01');
    await setBalance(usd, 100, '2026-11-01');
    const bal = async (id: string) => balancesAt(await db.balances.toArray()).get(id)!.amount;

    const t = await saveTransfer({ date: '2026-11-10', fromId: salary, toId: broker, amount: 100_000, toAmount: 100_000 });
    expect([await bal(salary), await bal(broker)]).toEqual([200_000, 105_000]);

    // 改金額、加手續費
    await saveTransfer({ ...t, amount: 80_000, toAmount: 80_000, fee: 15 });
    expect([await bal(salary), await bal(broker)]).toEqual([219_985, 85_000]);

    // 換成美元帳戶（不同幣別）
    await saveTransfer({ ...t, toId: usd, amount: 32_000, toAmount: 1000, fee: undefined });
    expect([await bal(salary), await bal(broker), await bal(usd)]).toEqual([268_000, 5_000, 1100]);

    await deleteTransfer(t.id);
    expect([await bal(salary), await bal(broker), await bal(usd)]).toEqual([300_000, 5_000, 100]);
    await expect(saveTransfer({ date: '2026-11-10', fromId: salary, toId: salary, amount: 1, toAmount: 1 })).rejects.toThrow('同一個帳戶');
    clock.mockRestore();
  });
});

describe('money', () => {
  it('deducts from the chosen account or voucher, and reverts on edit and delete', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const post = await saveAccount({ name: '郵局', kind: 'deposit' });
    await setBalance(post, 10_000, '2026-11-01');
    const bal = async () => balancesAt(await db.balances.toArray()).get(post)!.amount;
    const e = await saveExpense({ date: '2026-11-09', amount: 300, cat: 'shopping', item: '書', payWith: `acct:${post}` });
    expect(await bal()).toBe(9_700);
    await saveExpense({ ...e, amount: 350 });
    expect(await bal()).toBe(9_650);

    await db.giftCards.add({ id: 'g7', name: '7-11', emoji: '🏪', unit: 'money', denom: 100, created: 0, log: [{ id: 'i', date: '2026-11-01', amount: 1000, kind: 'init' }] });
    await saveExpense({ ...e, amount: 200, payWith: 'gift:g7' });
    expect(await bal()).toBe(10_000);
    expect(giftBalance((await db.giftCards.get('g7'))!)).toBe(800);

    await saveExpense({ ...e, amount: 200, payWith: 'cash' });
    expect(giftBalance((await db.giftCards.get('g7'))!)).toBe(1000);
    await saveExpense({ ...e, amount: 120, payWith: `acct:${post}` });
    await deleteExpense(e.id);
    expect(await bal()).toBe(10_000);
    expect((await db.settings.get('main'))?.lastPayWith).toBe(`acct:${post}`);
    clock.mockRestore();
  });

  it('remembers items and their last price', async () => {
    await saveExpense({ date: '2026-11-09', amount: 110, cat: 'food', meal: 'meal', item: '排骨便當' });
    await saveExpense({ date: '2026-11-10', amount: 120, cat: 'food', meal: 'meal', item: '排骨便當' });
    const q = await db.quickItems.get('food|meal|排骨便當');
    expect(q).toMatchObject({ amount: 120, count: 2 });
  });

  it('computes next charge and monthly cost', () => {
    const s: Subscription = { id: 's', name: 'Claude', amount: 20, currency: 'USD', cycle: 'monthly', billingDay: 31, category: 'tool', status: 'active' };
    expect(nextCharge(s, '2026-11-09')).toBe('2026-11-30');
    expect(monthlyTWD(s, 32)).toBe(640);
    expect(monthlyTWD({ ...s, currency: 'TWD', amount: 1200, cycle: 'yearly', billingMonth: 3 }, 32)).toBe(100);
  });

  it('does not lose voucher taps made in a row', async () => {
    const g = { id: 'g', name: '7-11', emoji: '🏪', unit: 'money' as const, denom: 100, created: 0, log: [{ id: 'i', date: '2026-11-09', amount: 2000, kind: 'init' as const }] };
    await db.giftCards.add(g);
    await Promise.all([addGiftLog(g, { date: '2026-11-09', amount: -100, kind: 'use' }), addGiftLog(g, { date: '2026-11-09', amount: -100, kind: 'use' })]);
    expect(giftCount((await db.giftCards.get('g'))!)).toBe(18);
  });
});

describe('import & backup', () => {
  it('imports the PWA backup', async () => {
    const r = await importPwaBackup({
      settings: { usdRate: 31 },
      subs: [{ id: 'a', name: 'Netflix', amount: 390, currency: 'TWD', cycle: 'monthly', billingDay: 9, billingMonth: null, category: 'video', status: 'active' }],
      expenseCats: [
        { id: 'food', name: '餐飲', emoji: '🍱', color: '#2a78d6' },
        { id: 'other', name: '其他', emoji: '📦', color: '#4a3aa7' },
      ],
      expenses: [{ id: 'e', date: '2026-11-01', amount: 110, cat: 'food', meal: 'meal', item: '排骨便當', note: '' }],
      quickItems: { 'food|meal|排骨便當': { cat: 'food', meal: 'meal', item: '排骨便當', amount: 110, count: 3, last: 1 } },
      giftCards: [{ id: 'g', name: '7-11 禮券', emoji: '🏪', unit: 'money', denom: 100, created: 1, log: [{ id: 'l', date: '2026-11-01', amount: 2300, kind: 'init' }] }],
    });
    expect(r).toEqual({ subs: 1, expenses: 1, giftCards: 1 });
    expect((await db.settings.get('main'))?.usdRate).toBe(31);
    expect((await db.subscriptions.get('a'))?.billingMonth).toBeUndefined();
    expect((await db.quickItems.get('food|meal|排骨便當'))?.count).toBe(3);
  });

  it('includes wallet data in backups', async () => {
    await saveExpense({ date: '2026-11-09', amount: 50, cat: 'transport', item: '捷運' });
    await db.trades.add(trade({}));
    const b = await buildBackup();
    expect(b.wallet?.expenses).toHaveLength(1);
    await db.expenses.clear();
    await db.trades.clear();
    await restoreBackup(b);
    expect(await db.expenses.count()).toBe(1);
    expect(await db.trades.count()).toBe(1);
    expect(await db.expenseCats.count()).toBe(7);
  });
});
