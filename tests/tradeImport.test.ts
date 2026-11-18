import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimeLedgerDB, db } from '../src/db';
import { ensureSeeded } from '../src/defaults';
import { analyzePositions } from '../src/wallet/positions';
import { CLAUDE_PROMPT, applyImport, mismatchReport, monthsOf, parseTradeImport, planImport, priorPositions, summarizeBySymbol } from '../src/wallet/tradeImport';

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

  it('replaces only the months in the file by default, without touching account balances', async () => {
    const manual = (id: string, date: string) => ({ id, date, side: 'buy' as const, symbol: '2317', price: 100, shares: 1000, createdAt: 1, accountId: 'x', cash: -100_000 });
    await db.trades.bulkAdd([manual('oct', '2026-10-15'), manual('nov', '2026-11-20')]);
    const balancesBefore = await db.balances.count();
    const plan = planImport(parsed(), 32, 1000);
    expect(monthsOf(plan)).toEqual(['2026-11']);

    const r1 = await applyImport(plan, { mode: 'months', addOpening: false });
    expect(r1).toEqual({ added: 2, skipped: 0, removed: 1 });
    expect(await db.trades.get('nov')).toBeUndefined();
    expect(await db.trades.get('oct')).toBeDefined();
    expect(await db.balances.count()).toBe(balancesBefore);

    // 再匯入同一個月：整個月換掉，不會重複
    const r2 = await applyImport(planImport(parsed(), 32, 2000), { mode: 'months', addOpening: false });
    expect(r2).toEqual({ added: 2, skipped: 0, removed: 2 });
    expect(await db.trades.count()).toBe(3);

    const r3 = await applyImport(planImport(parsed(), 32, 3000), { mode: 'append', addOpening: false });
    expect(r3).toEqual({ added: 0, skipped: 2, removed: 0 });

    const r4 = await applyImport(planImport(parsed(), 32, 4000), { mode: 'all', addOpening: true });
    expect(r4).toEqual({ added: 4, skipped: 0, removed: 3 });
    expect((await db.trades.toArray()).every((t) => !t.accountId)).toBe(true);
  });
});

describe('day trades and holdings check', () => {
  it('reads 沖買／沖賣 as a closed day trade, and flags a holding the trades cannot explain', () => {
    const p = parseTradeImport(
      file({
        trades: [
          { date: '2026-11-02', side: '沖買', symbol: '6274', name: '台燿', price: 400, shares: 1000, fee: 570 },
          { date: '2026-11-02', side: '現股當沖賣出', symbol: '6274', name: '台燿', price: 410, shares: 1000, fee: 584, tax: 615 },
          { date: '2026-11-04', side: '融資買進', symbol: '2330', price: 1000, shares: 1000 },
        ],
        // Claude 誤把當沖的台燿放進庫存
        holdings: [
          { symbol: '6274', name: '台燿', shares: 1000, avgCost: 400 },
          { symbol: '2330', shares: 1000, avgCost: 1001 },
        ],
      }),
    );
    expect(p.rows.map((r) => [r.side, r.daytrade])).toEqual([
      ['buy', true],
      ['sell', true],
      ['buy', undefined],
    ]);
    const s = summarizeBySymbol(p);
    const taiyao = s.find((x) => x.symbol === '6274')!;
    expect(taiyao).toMatchObject({ bought: 1000, sold: 1000, net: 0, holding: 1000, dayTradeDates: ['2026-11-02'], status: 'mismatch' });
    expect(s.find((x) => x.symbol === '2330')!.status).toBe('ok');
    expect(mismatchReport(s)).toContain('6274 台燿：交易明細 買 1000 股、賣 1000 股（淨 +0），庫存截圖 1000 股');
    // 預設不補期初持股，誤判的庫存不會變成持股
    expect(planImport(p).trades.find((t) => t.symbol === '6274')?.reason).toBe('當沖');
  });

  it('counts shares held before the file month, so buy-in-Oct / sell-in-Nov is not a mismatch', async () => {
    // App 裡已經有 10 月買進的 3008
    await db.trades.add({ id: 'oct', date: '2026-10-20', side: 'buy', symbol: '3008', price: 2000, shares: 1000, createdAt: 1 });
    await db.trades.add({ id: 'oct2', date: '2026-10-21', side: 'buy', symbol: '2317', price: 100, shares: 2000, createdAt: 2 });
    const p = parseTradeImport(
      file({
        trades: [{ date: '2026-11-10', side: 'sell', symbol: '3008', price: 2100, shares: 1000 }],
        holdings: [{ symbol: '2317', shares: 2000, avgCost: 100 }],
      }),
    );
    const prior = priorPositions(await db.trades.toArray(), p, 'months');
    const s = summarizeBySymbol(p, prior);
    expect(s.find((x) => x.symbol === '3008')).toMatchObject({ prior: 1000, sold: 1000, holding: 0, status: 'ok' });
    // 11 月沒交易、10 月買的還在庫存 → 一樣對得上
    expect(s.find((x) => x.symbol === '2317')).toMatchObject({ prior: 2000, net: 0, holding: 2000, status: 'ok' });
    expect(mismatchReport(s)).toBe('');
    // 期初持股不會重複補
    expect(planImport(p, 32, 1, prior).opening).toEqual([]);
    // 選「取代全部」時舊紀錄會刪掉，就沒有月初持有
    expect(priorPositions(await db.trades.toArray(), p, 'all').size).toBe(0);
  });

  it('treats selling shares bought before any recorded month as informational, not an error', () => {
    const p = parseTradeImport(
      file({
        trades: [{ date: '2026-11-10', side: 'sell', symbol: '3008', price: 2100, shares: 1000 }],
        holdings: [{ symbol: '2330', shares: 1000 }],
      }),
    );
    const s = summarizeBySymbol(p);
    expect(s.find((x) => x.symbol === '3008')!.status).toBe('soldEarlier');
    expect(mismatchReport(s)).not.toContain('3008');
  });

  it('flags trades that leave shares the holdings screenshot does not show', () => {
    const p = parseTradeImport(
      file({
        trades: [{ date: '2026-11-02', side: 'buy', symbol: '6274', price: 400, shares: 1000 }],
        holdings: [{ symbol: '2330', shares: 1000 }],
      }),
    );
    expect(summarizeBySymbol(p).find((x) => x.symbol === '6274')).toMatchObject({ net: 1000, holding: 0, status: 'mismatch' });
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
