import { db, uid, type Expense, type GiftCard, type PayMethod } from '../db';
import { accountKind, adjustBalance, currencyOf } from './assets';
import { giftBalance, quickId, round2 } from './money';

export const CASH = 'cash';

export interface PayOption {
  /** 存在 Expense.payWith 的值 */
  value: string;
  label: string;
  /** 會從哪裡扣錢（現金、信用卡只標記） */
  deducts: boolean;
  hint?: string;
}

/** 可選的付款方式：現金、綜合存款帳戶、禮券（有餘額的金額型）、信用卡／電子支付 */
export async function payOptions(): Promise<PayOption[]> {
  const [accounts, gifts, settings] = await Promise.all([db.accounts.orderBy('order').toArray(), db.giftCards.toArray(), db.settings.get('main')]);
  const opts: PayOption[] = [{ value: CASH, label: '現金', deducts: true, hint: '從「現金」帳戶扣' }];
  for (const a of accounts) {
    if (a.archived || a.cash || accountKind(a) !== 'deposit' || currencyOf(a) !== 'TWD') continue;
    opts.push({ value: `acct:${a.id}`, label: a.name, deducts: true, hint: '從帳戶餘額扣' });
  }
  for (const m of settings?.payMethods ?? []) opts.push({ value: `pay:${m.id}`, label: m.name, deducts: false, hint: m.kind === 'card' ? '信用卡' : '電子支付' });
  for (const g of gifts) {
    if (g.unit !== 'money' || giftBalance(g) <= 0) continue;
    opts.push({ value: `gift:${g.id}`, label: `${g.emoji} ${g.name}`, deducts: true, hint: '從禮券餘額扣' });
  }
  return opts;
}

/** 付款方式的顯示名稱（帳戶或禮券刪掉後仍能顯示） */
export function payLabel(value: string | undefined, names: Map<string, string>): string {
  if (!value) return '';
  if (value === CASH) return '現金';
  return names.get(value) ?? '（已刪除）';
}

export async function addPayMethod(name: string, kind: PayMethod['kind']): Promise<string> {
  const cur = (await db.settings.get('main'))!;
  const m: PayMethod = { id: uid(), name: name.trim(), kind };
  await db.settings.put({ ...cur, payMethods: [...(cur.payMethods ?? []), m] });
  return `pay:${m.id}`;
}

export async function removePayMethod(id: string): Promise<void> {
  const cur = (await db.settings.get('main'))!;
  await db.settings.put({ ...cur, payMethods: (cur.payMethods ?? []).filter((m) => m.id !== id) });
}

/** 「現金」帳戶的 id；還沒有的話建立一個（綜合存款、台幣），刪除過的會重新啟用 */
export async function ensureCashAccount(): Promise<string> {
  const all = await db.accounts.toArray();
  const found = all.find((a) => a.cash);
  if (found) {
    if (found.archived) await db.accounts.update(found.id, { archived: false });
    return found.id;
  }
  const id = uid();
  const max = all.reduce((m, a) => Math.max(m, a.order), -1);
  await db.accounts.add({ id, name: '現金', kind: 'deposit', cash: true, order: max + 1 });
  return id;
}

/** 還原這筆支出之前扣掉的錢 */
async function revert(e: Expense | undefined, date: string): Promise<void> {
  const d = e?.deducted;
  if (!d) return;
  if (d.kind === 'acct') await adjustBalance(d.id, d.amount, date);
  else {
    const g = await db.giftCards.get(d.id);
    if (g) await db.giftCards.put({ ...g, log: g.log.filter((l) => l.id !== d.logId) });
  }
}

/** 依付款方式扣錢，回傳扣款紀錄 */
async function deduct(e: Expense): Promise<Expense['deducted']> {
  if (e.payWith === CASH) {
    const id = await ensureCashAccount();
    await adjustBalance(id, -e.amount, e.date);
    return { kind: 'acct', id, amount: e.amount };
  }
  const [kind, id] = (e.payWith ?? '').split(':');
  if (kind === 'acct' && id) {
    await adjustBalance(id, -e.amount, e.date);
    return { kind: 'acct', id, amount: e.amount };
  }
  if (kind === 'gift' && id) {
    const g: GiftCard | undefined = await db.giftCards.get(id);
    if (!g) return undefined;
    const logId = uid();
    await db.giftCards.put({ ...g, log: [...g.log, { id: logId, date: e.date, amount: -e.amount, kind: 'use', note: e.item || '記帳' }] });
    return { kind: 'gift', id, amount: e.amount, logId };
  }
  return undefined;
}

/**
 * 儲存支出：記住品項與金額，並依付款方式扣帳戶或禮券餘額。
 * 編輯時先還原舊的扣款再重新扣，所以改金額、改付款方式都不會算錯。
 */
export async function saveExpense(data: Omit<Expense, 'id' | 'createdAt' | 'deducted'> & { id?: string }): Promise<Expense> {
  const tables = [db.expenses, db.quickItems, db.balances, db.giftCards, db.settings, db.accounts];
  return db.transaction('rw', tables, async () => {
    const existing = data.id ? await db.expenses.get(data.id) : undefined;
    const e: Expense = {
      ...data,
      id: data.id ?? uid(),
      amount: round2(data.amount),
      meal: data.cat === 'food' ? (data.meal ?? 'meal') : undefined,
      item: data.item.trim(),
      note: data.note?.trim() || undefined,
      payWith: data.payWith || undefined,
      backfill: data.backfill || undefined,
      skipDeduct: data.skipDeduct || undefined,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await revert(existing, e.date);
    e.deducted = e.skipDeduct ? undefined : await deduct(e);
    await db.expenses.put(e);

    // 記住品項與這次的金額
    if (e.item) {
      const id = quickId(e.cat, e.meal, e.item);
      const q = await db.quickItems.get(id);
      const changed = !existing || existing.item !== e.item || existing.cat !== e.cat || existing.meal !== e.meal;
      await db.quickItems.put({ id, cat: e.cat, meal: e.meal, item: e.item, amount: e.amount, count: (q?.count ?? 0) + (changed ? 1 : 0) || 1, last: Date.now() });
    }
    // 下次預設用同一個付款方式；補登記住這次有沒有扣款
    const s = await db.settings.get('main');
    if (s) {
      const next = {
        ...s,
        ...(e.payWith ? { lastPayWith: e.payWith } : {}),
        ...(e.backfill ? { backfillDeduct: !e.skipDeduct } : {}),
      };
      if (next.lastPayWith !== s.lastPayWith || next.backfillDeduct !== s.backfillDeduct) await db.settings.put(next);
    }
    return e;
  });
}

export async function deleteExpense(id: string): Promise<void> {
  await db.transaction('rw', [db.expenses, db.balances, db.giftCards], async () => {
    const e = await db.expenses.get(id);
    await revert(e, e?.date ?? '');
    await db.expenses.delete(id);
  });
}
