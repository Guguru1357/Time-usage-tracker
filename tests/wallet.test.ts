import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, restoreBackup } from '../src/backup';
import { db, type Subscription, type Trade } from '../src/db';
import { ensureSeeded } from '../src/defaults';
import { salaryReminderTimes, tradeReminderTimes } from '../src/notifications';
import { HOUR, MIN, dayStart } from '../src/time';
import { addIncome, fmtMoney, rateOf, saveAccount, setBalance, totalAt } from '../src/wallet/assets';
import { importPwaBackup } from '../src/wallet/importPwa';
import { addGiftLog, giftCount, monthlyTWD, nextCharge, saveExpense } from '../src/wallet/money';
import { analyzePositions, tradeReport, weeklyCounts } from '../src/wallet/stocks';

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
  emotion: 'calm',
  planned: true,
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

  it('flags overtrading, revenge trades and unplanned trades', () => {
    const list = [
      trade({ date: '2026-11-02', price: 100 }),
      trade({ date: '2026-11-03', side: 'sell', price: 90, emotion: 'fear', planned: false }),
      trade({ date: '2026-11-03', price: 95, emotion: 'revenge', planned: false }),
      trade({ date: '2026-11-03', symbol: '2317', emotion: 'fomo', planned: false }),
      trade({ date: '2026-11-03', symbol: '2317', side: 'sell', emotion: 'impulse', planned: false, price: 101 }),
    ];
    const r = tradeReport(list, '2026-10-10', '2026-11-08');
    expect(r.count).toBe(5);
    expect(r.unplanned).toBe(4);
    expect(r.emotions.get('fear')?.pnl).toBe(-10_000);
    const text = r.warnings.map((w) => w.text).join('\n');
    expect(text).toContain('單日交易 4 筆以上');
    expect(text).toContain('賠錢賣出後一天內又買進');
    expect(text).toContain('不在計畫內');
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
    const post = await saveAccount({ name: '郵局', kind: 'post' });
    const bank = await saveAccount({ name: '國泰', kind: 'bank' });
    await setBalance(post, 50_000, '2026-10-31');
    await setBalance(bank, 20_000, '2026-10-31');
    await addIncome({ date: '2026-11-07', amount: 40_000, kind: 'salary', accountId: bank }, true);
    const [accounts, balances] = [await db.accounts.toArray(), await db.balances.toArray()];
    const twdOnly = (c: string) => (c === 'TWD' ? 1 : undefined);
    expect(totalAt(accounts, balances, twdOnly, '2026-10-31').twd).toBe(70_000);
    expect(totalAt(accounts, balances, twdOnly).twd).toBe(110_000);
  });

  it('converts foreign currency accounts and reports currencies without a rate', async () => {
    const usd = await saveAccount({ name: '國泰 美元', kind: 'bank', currency: 'USD' });
    const jpy = await saveAccount({ name: '日圓帳戶', kind: 'bank', currency: 'JPY' });
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

describe('money', () => {
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
