import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimeLedgerDB, db } from '../src/db';
import { ensureSeeded } from '../src/defaults';
import { analyzePositions } from '../src/wallet/positions';
import { CLAUDE_PROMPT, applyImport, parseTradeImport, planImport } from '../src/wallet/tradeImport';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

const file = (o: unknown) => JSON.stringify(o);

describe('parse', () => {
  it('accepts loose formats from screenshots and adds tax to the fee', () => {
    const p = parseTradeImport(
      file({
        app: 'time-ledger-trades',
        trades: [
          { date: '2026/11/3', side: '現股買進', symbol: '2330', price: '1,000', shares: 1000, fee: 1425 },
          { date: '2026-11-05', side: '賣出', symbol: '2330', price: 1050, shares: 1000, fee: 1496, tax: 3150 },
          { date: '2026-11-06', side: 'buy', symbol: 'aapl', price: 230.5, shares: 0.5, fee: 1 },
          { date: '昨天', side: 'buy', symbol: '0050', price: 190, shares: 10 },
          { date: '2026-11-07', side: '?', symbol: '0050', price: 190, shares: 10 },
        ],
      }),
    );
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ date: '2026-11-03', side: 'buy', market: 'TW', price: 1000, fee: 1425 });
    expect(p.rows[1].fee).toBe(4646);
    expect(p.rows[2]).toMatchObject({ market: 'US', symbol: 'AAPL', shares: 0.5 });
    expect(p.errors).toEqual(['第 4 筆：日期看不懂（昨天）', '第 5 筆（0050）：看不出是買進還是賣出']);
  });

  it('rejects files that are not trade imports', () => {
    expect(() => parseTradeImport('not json')).toThrow('JSON');
    expect(() => parseTradeImport(file({ foo: 1 }))).toThrow('交易匯入檔');
  });

  it('ships a prompt that names the expected app id', () => {
    expect(CLAUDE_PROMPT).toContain('"app": "time-ledger-trades"');
  });
});

describe('plan & apply', () => {
  const parsed = () =>
    parseTradeImport(
      file({
        trades: [
          { date: '2026-11-03', side: 'buy', symbol: '2330', price: 1000, shares: 1000, fee: 1425 },
          { date: '2026-11-05', side: 'sell', symbol: '2330', price: 1050, shares: 500, fee: 748, tax: 1575 },
        ],
        holdings: [
          { symbol: '2330', name: '台積電', shares: 1500, avgCost: 980 },
          { symbol: '0050', shares: 2000, avgCost: 150 },
        ],
      }),
    );

  it('checks holdings and builds opening positions for what the trades do not cover', () => {
    const plan = planImport(parsed(), 32, 1000);
    expect(plan.from).toBe('2026-11-03');
    expect(plan.checks.map((c) => [c.symbol, c.expected, c.computed])).toEqual([
      ['2330', 1500, 500],
      ['0050', 2000, 0],
    ]);
    expect(plan.opening.map((t) => [t.symbol, t.shares, t.price, t.date])).toEqual([
      ['2330', 1000, 980, '2026-11-02'],
      ['0050', 2000, 150, '2026-11-02'],
    ]);
    const all = [...plan.opening, ...plan.trades];
    expect(analyzePositions(all).holdings.map((h) => [h.symbol, h.shares])).toEqual([
      ['2330', 1500],
      ['0050', 2000],
    ]);
  });

  it('replaces manual trades without touching account balances, or appends without duplicates', async () => {
    await db.trades.add({ id: 'old', date: '2026-10-01', side: 'buy', symbol: '2317', price: 100, shares: 1000, createdAt: 1, accountId: 'x', cash: -100_000 });
    const balancesBefore = await db.balances.count();
    const plan = planImport(parsed(), 32, 1000);

    const r1 = await applyImport(plan, { replace: true, addOpening: true });
    expect(r1).toEqual({ added: 4, skipped: 0, removed: 1 });
    expect(await db.trades.get('old')).toBeUndefined();
    expect(await db.balances.count()).toBe(balancesBefore);
    expect((await db.trades.toArray()).every((t) => !t.accountId)).toBe(true);

    const r2 = await applyImport(planImport(parsed(), 32, 2000), { replace: false, addOpening: false });
    expect(r2).toEqual({ added: 0, skipped: 2, removed: 0 });
  });
});

it('v6 → v7 removes the old trade mood and planned fields', async () => {
  const name = 'mood-migration';
  const old = new Dexie(name);
  old.version(6).stores({ trades: 'id, date, symbol' });
  await old.open();
  await old.table('trades').add({ id: 't', date: '2026-11-01', side: 'buy', symbol: '2330', price: 1, shares: 1, createdAt: 1, emotion: 'fomo', planned: false });
  old.close();
  const next = new TimeLedgerDB(name);
  await next.open();
  const t = (await next.trades.get('t')) as unknown as Record<string, unknown>;
  expect('emotion' in t).toBe(false);
  expect('planned' in t).toBe(false);
  next.close();
});
