import { db, uid, type Expense, type ExpenseCat, type GiftCard, type QuickItem, type Subscription } from '../db';
import { updateSettings } from '../repo';

/** 訂閱追蹤器（網頁版）匯出的 JSON，只取用得到的欄位 */
interface PwaBackup {
  settings?: { usdRate?: number };
  subs?: Partial<Omit<Subscription, 'billingDay' | 'billingMonth' | 'lastReviewed'> & { billingDay: number | null; billingMonth: number | null; lastReviewed: string | null }>[];
  expenseCats?: Partial<ExpenseCat>[];
  expenses?: Partial<Omit<Expense, 'meal'> & { meal: string | null }>[];
  quickItems?: Record<string, Partial<Omit<QuickItem, 'meal'> & { meal: string | null }>>;
  giftCards?: Partial<GiftCard>[];
}

export interface PwaImportSummary {
  subs: number;
  expenses: number;
  giftCards: number;
}

const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function isPwaBackup(data: unknown): data is PwaBackup {
  return !!data && typeof data === 'object' && Array.isArray((data as PwaBackup).subs);
}

/**
 * 匯入網頁版的訂閱、記帳、禮券。
 * 會取代 App 裡目前的訂閱、記帳與禮券（時間紀錄、安排、習慣、資產、股票不受影響）。
 */
export async function importPwaBackup(data: PwaBackup): Promise<PwaImportSummary> {
  const cats: ExpenseCat[] = (data.expenseCats ?? [])
    .filter((c) => c?.id && c.name)
    .map((c, order) => ({ id: c.id!, name: c.name!, emoji: c.emoji ?? '', color: c.color ?? '#9a96b3', order }));
  const catIds = new Set(cats.map((c) => c.id));

  const expenses: Expense[] = (data.expenses ?? [])
    .filter((e) => isYmd(e?.date) && num(e.amount) > 0)
    .map((e) => {
      const cat = e.cat && (catIds.size === 0 || catIds.has(e.cat)) ? e.cat : 'other';
      return {
        id: e.id || uid(),
        date: e.date!,
        amount: num(e.amount),
        cat,
        meal: cat === 'food' ? (e.meal === 'snack' ? 'snack' : 'meal') : undefined,
        item: e.item ?? '',
        note: e.note || undefined,
        createdAt: Date.now(),
      };
    });

  const quickItems: QuickItem[] = Object.values(data.quickItems ?? {})
    .filter((q) => q?.item && q.cat)
    .map((q) => {
      const meal = q.cat === 'food' ? (q.meal === 'snack' ? 'snack' : 'meal') : undefined;
      return { id: `${q.cat}|${meal ?? ''}|${q.item}`, cat: q.cat!, meal, item: q.item!, amount: num(q.amount), count: num(q.count) || 1, last: num(q.last) };
    });

  const subs: Subscription[] = (data.subs ?? [])
    .filter((s) => s?.name)
    .map((s) => ({
      id: s.id || uid(),
      name: s.name!,
      amount: num(s.amount),
      currency: s.currency === 'USD' ? 'USD' : 'TWD',
      cycle: s.cycle === 'yearly' ? 'yearly' : 'monthly',
      billingDay: s.billingDay ?? undefined,
      billingMonth: s.billingMonth ?? undefined,
      payment: s.payment || undefined,
      category: (['video', 'tool', 'shopping', 'other'] as const).includes(s.category as Subscription['category']) ? s.category! : 'other',
      status: (['active', 'considering', 'cancelled'] as const).includes(s.status as Subscription['status']) ? s.status! : 'active',
      lastReviewed: s.lastReviewed ?? undefined,
    }));

  const giftCards: GiftCard[] = (data.giftCards ?? [])
    .filter((g) => g?.name && Array.isArray(g.log))
    .map((g) => ({
      id: g.id || uid(),
      name: g.name!,
      emoji: g.emoji || '🎁',
      unit: g.unit === 'points' ? 'points' : 'money',
      denom: g.denom || undefined,
      expiry: g.expiry || undefined,
      place: g.place || undefined,
      created: num(g.created) || Date.now(),
      log: g.log!.filter((l) => isYmd(l.date)).map((l) => ({ id: l.id || uid(), date: l.date, amount: num(l.amount), kind: l.kind ?? 'add', note: l.note || undefined })),
    }));

  await db.transaction('rw', [db.expenseCats, db.expenses, db.quickItems, db.subscriptions, db.giftCards, db.kv], async () => {
    if (cats.length) {
      await db.expenseCats.clear();
      await db.expenseCats.bulkAdd(cats);
    }
    await Promise.all([db.expenses.clear(), db.quickItems.clear(), db.subscriptions.clear(), db.giftCards.clear()]);
    await db.expenses.bulkAdd(expenses);
    await db.quickItems.bulkPut(quickItems);
    await db.subscriptions.bulkAdd(subs);
    await db.giftCards.bulkAdd(giftCards);
    // 已經有訂閱清單，不要再建立預設訂閱
    await db.kv.put({ key: 'subs:seeded', value: true });
  });
  if (data.settings?.usdRate && data.settings.usdRate > 0) await updateSettings({ usdRate: data.settings.usdRate });
  return { subs: subs.length, expenses: expenses.length, giftCards: giftCards.length };
}
