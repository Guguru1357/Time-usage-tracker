import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, type Subscription } from '../src/db';
import { ensureSeeded } from '../src/defaults';
import { balancesAt, saveAccount, setBalance } from '../src/wallet/assets';
import { addPayMethod } from '../src/wallet/expenses';
import { chargeAccountId, chargeDates, processSubCharges, setCardPayFrom, undoSubCharge } from '../src/wallet/subCharges';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
});

const sub = (s: Partial<Subscription>): Subscription => ({
  id: 'netflix',
  name: 'Netflix',
  amount: 390,
  currency: 'TWD',
  cycle: 'monthly',
  billingDay: 5,
  category: 'video',
  status: 'active',
  ...s,
});

it('lists billing dates in a range, clamping short months', () => {
  expect(chargeDates(sub({ billingDay: 31 }), '2026-01-15', '2026-04-10')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  expect(chargeDates(sub({ cycle: 'yearly', billingMonth: 3, billingDay: 1 }), '2026-01-01', '2027-12-31')).toEqual(['2026-03-01', '2027-03-01']);
});

it('charges the card bill account on each billing day since autoFrom, once', async () => {
  const bank = await saveAccount({ name: '國泰', kind: 'deposit' });
  await setBalance(bank, 10_000, '2026-09-01');
  const bal = async () => balancesAt(await db.balances.toArray()).get(bank)!.amount;
  const card = (await addPayMethod('CUBE 卡', 'card')).slice(4);
  await db.subscriptions.put(sub({ payWith: `pay:${card}`, autoFrom: '2026-09-10' }));

  // 卡片還沒設定卡費帳戶：不扣
  expect(await processSubCharges('2026-11-20')).toEqual([]);
  expect(chargeAccountId({ payWith: `pay:${card}` }, (await db.settings.get('main'))!)).toBeUndefined();

  await setCardPayFrom(card, bank);
  const made = await processSubCharges('2026-11-20');
  // 9/5 在 autoFrom 之前，不補扣；10/5、11/5 各扣一次
  expect(made.map((c) => c.date)).toEqual(['2026-10-05', '2026-11-05']);
  expect(await bal()).toBe(10_000 - 780);
  expect(await processSubCharges('2026-11-20')).toEqual([]);
  expect(await bal()).toBe(10_000 - 780);

  // 撤銷一筆：錢加回來，而且不會再被扣
  await undoSubCharge(made[1].id);
  await undoSubCharge(made[1].id);
  expect(await bal()).toBe(10_000 - 390);
  expect(await processSubCharges('2026-11-20')).toEqual([]);
});

it('converts USD at the saved rate, charges accounts directly, skips cancelled', async () => {
  const bank = await saveAccount({ name: '郵局', kind: 'deposit' });
  await setBalance(bank, 5_000, '2026-11-01');
  const s = (await db.settings.get('main'))!;
  await db.settings.put({ ...s, usdRate: 31.5 });
  await db.subscriptions.bulkPut([
    sub({ id: 'claude', name: 'Claude', amount: 20, currency: 'USD', billingDay: 3, payWith: `acct:${bank}`, autoFrom: '2026-11-01' }),
    sub({ id: 'old', status: 'cancelled', payWith: `acct:${bank}`, autoFrom: '2026-11-01' }),
  ]);
  const made = await processSubCharges('2026-11-10');
  expect(made).toHaveLength(1);
  expect(made[0].amount).toBe(630);
  expect(balancesAt(await db.balances.toArray()).get(bank)!.amount).toBe(4_370);
});
