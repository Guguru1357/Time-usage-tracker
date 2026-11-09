import { db, uid, type Account, type Balance, type Income } from '../db';
import { round2 } from './money';

export const ACCOUNT_KINDS: Record<Account['kind'], string> = {
  post: '郵局',
  bank: '銀行',
  cash: '現金',
  broker: '證券交割戶',
  other: '其他',
};

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

export function totalAt(accounts: Account[], balances: Balance[], date?: string): number {
  const live = new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
  let sum = 0;
  for (const [id, b] of balancesAt(balances, date)) if (live.has(id)) sum += b.amount;
  return round2(sum);
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
  await db.balances.add({ id: uid(), accountId, amount: round2(amount), date, createdAt: Date.now() });
}

/** 新增收入；指定帳戶時一併把金額加到該帳戶餘額 */
export async function addIncome(data: Omit<Income, 'id'>, addToAccount: boolean): Promise<void> {
  await db.transaction('rw', db.incomes, db.balances, async () => {
    await db.incomes.add({ ...data, id: uid(), amount: round2(data.amount) });
    if (addToAccount && data.accountId) {
      const cur = balancesAt(await db.balances.where('accountId').equals(data.accountId).toArray()).get(data.accountId);
      await db.balances.add({ id: uid(), accountId: data.accountId, amount: round2((cur?.amount ?? 0) + data.amount), date: data.date, createdAt: Date.now() });
    }
  });
}

export function salaryInMonth(incomes: Income[], month: string): Income[] {
  return incomes.filter((i) => i.kind === 'salary' && i.date.startsWith(month));
}
