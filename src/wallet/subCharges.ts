import { db, uid, type Account, type PayMethod, type Settings, type SubCharge, type Subscription } from '../db';
import { addDays, todayKey } from '../time';
import { accountKind, adjustBalance, currencyOf } from './assets';
import { DEFAULT_USD_RATE, chargeTWD, nextCharge, round2 } from './money';

/** 可以扣訂閱、繳卡費的帳戶：台幣綜合存款（含現金） */
export function chargeableAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => !a.archived && accountKind(a) === 'deposit' && currencyOf(a) === 'TWD');
}

export function cardsOf(settings: Pick<Settings, 'payMethods'>): PayMethod[] {
  return (settings.payMethods ?? []).filter((m) => m.kind === 'card');
}

/** 這個訂閱會從哪個帳戶扣錢；信用卡要設定卡費帳戶才算 */
export function chargeAccountId(s: Pick<Subscription, 'payWith'>, settings: Pick<Settings, 'payMethods'>): string | undefined {
  const [kind, id] = (s.payWith ?? '').split(':');
  if (kind === 'acct') return id || undefined;
  if (kind === 'pay') return settings.payMethods?.find((m) => m.id === id)?.payFrom;
  return undefined;
}

/** from 到 to（含）之間所有的扣款日 */
export function chargeDates(s: Subscription, from: string, to: string): string[] {
  const out: string[] = [];
  let d = nextCharge(s, from);
  while (d && d <= to && out.length < 400) {
    out.push(d);
    d = nextCharge(s, addDays(d, 1));
  }
  return out;
}

export interface NewCharge extends SubCharge {
  name: string;
}

let running: Promise<NewCharge[]> | null = null;

/**
 * 補上到今天為止該扣、還沒扣的訂閱款項。
 * 開 App、回到 App、打開訂閱頁時呼叫；同時呼叫會排隊，不會重複扣。
 */
export function processSubCharges(today = todayKey()): Promise<NewCharge[]> {
  running = (running ?? Promise.resolve([])).catch(() => []).then(() => doProcess(today));
  return running;
}

async function doProcess(today: string): Promise<NewCharge[]> {
  return db.transaction('rw', [db.subscriptions, db.subCharges, db.balances, db.settings, db.accounts], async () => {
    const settings = await db.settings.get('main');
    if (!settings) return [];
    const rate = settings.usdRate ?? DEFAULT_USD_RATE;
    const accounts = new Map(chargeableAccounts(await db.accounts.toArray()).map((a) => [a.id, a]));
    const created: NewCharge[] = [];
    for (const s of await db.subscriptions.toArray()) {
      if (s.status === 'cancelled' || !s.amount || !s.autoFrom || !s.payWith) continue;
      const accountId = chargeAccountId(s, settings);
      if (!accountId || !accounts.has(accountId)) continue;
      const done = new Set((await db.subCharges.where('subId').equals(s.id).toArray()).map((c) => c.date));
      for (const date of chargeDates(s, s.autoFrom, today)) {
        if (done.has(date)) continue;
        const amount = round2(chargeTWD(s, rate));
        await adjustBalance(accountId, -amount, date);
        const c: SubCharge = { id: uid(), subId: s.id, date, amount, accountId, payWith: s.payWith, createdAt: Date.now() };
        await db.subCharges.add(c);
        created.push({ ...c, name: s.name });
      }
    }
    return created;
  });
}

/** 撤銷一筆自動扣款：錢加回帳戶，之後也不會再扣這一天 */
export async function undoSubCharge(id: string): Promise<void> {
  await db.transaction('rw', [db.subCharges, db.balances, db.subscriptions], async () => {
    const c = await db.subCharges.get(id);
    if (!c || c.undone) return;
    await adjustBalance(c.accountId, c.amount, c.date);
    // 保留紀錄並標記撤銷，這天就不會被重新扣
    await db.subCharges.put({ ...c, undone: true });
  });
}

/** 設定信用卡的卡費扣款帳戶 */
export async function setCardPayFrom(cardId: string, accountId: string | undefined): Promise<void> {
  const cur = (await db.settings.get('main'))!;
  await db.settings.put({
    ...cur,
    payMethods: (cur.payMethods ?? []).map((m) => (m.id === cardId ? { ...m, payFrom: accountId } : m)),
  });
}
