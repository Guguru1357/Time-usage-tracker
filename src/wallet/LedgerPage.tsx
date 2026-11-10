import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { IconPlus } from '../components/Icons';
import { db, type Expense, type ExpenseCat, type Meal } from '../db';
import { useSettings } from '../hooks';
import { dayStart, fmtDateLabel, todayKey } from '../time';
import {
  DEFAULT_USD_RATE,
  MEALS,
  chargeTWD,
  fmtNum,
  fmtTWD,
  guessMeal,
  monthRange,
  nextCharge,
  quickId,
  sortQuickItems,
} from './money';
import { CASH, addPayMethod, deleteExpense, payLabel, payOptions, removePayMethod, saveExpense } from './expenses';
import { BarChart, HBarList, MonthNav, Sheet, numOrUndef, useToast } from './ui';

/** 付款方式的顯示名稱：帳戶、禮券（含已刪除的）、信用卡／電子支付 */
function usePayNames(): Map<string, string> {
  return (
    useLiveQuery(async () => {
      const [accounts, gifts, settings] = await Promise.all([db.accounts.toArray(), db.giftCards.toArray(), db.settings.get('main')]);
      const m = new Map<string, string>();
      for (const a of accounts) m.set(`acct:${a.id}`, a.name);
      for (const g of gifts) m.set(`gift:${g.id}`, `${g.emoji} ${g.name}`);
      for (const p of settings?.payMethods ?? []) m.set(`pay:${p.id}`, p.name);
      return m;
    }) ?? new Map()
  );
}

const OTHER: ExpenseCat = { id: 'other', name: '其他', emoji: '📦', color: '#9a96b3', order: 99 };

export function LedgerPage() {
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [mode, setMode] = useState<'list' | 'stats'>('list');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  const [, say, toast] = useToast();
  const payNames = usePayNames();
  const { from, to } = monthRange(month);
  const cats = useLiveQuery(() => db.expenseCats.orderBy('order').toArray()) ?? [];
  const list = useLiveQuery(() => db.expenses.where('date').between(from, to, true, true).toArray(), [from, to]) ?? [];
  const catOf = (id: string) => cats.find((c) => c.id === id) ?? OTHER;

  const shown = list.filter((e) => filter === 'all' || e.cat === filter);
  const total = shown.reduce((a, e) => a + e.amount, 0);
  const byDate = new Map<string, Expense[]>();
  for (const e of [...shown].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }
  const usedCats = cats.filter((c) => list.some((e) => e.cat === c.id));

  return (
    <>
      <MonthNav month={month} onChange={setMonth} />
      <div className="big-total">
        <span>{filter === 'all' ? '本月支出' : catOf(filter).name}</span>
        <b>{fmtTWD(total)}</b>
        <small className="muted">{shown.length} 筆</small>
      </div>
      <div className="segmented">
        <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>
          明細
        </button>
        <button className={mode === 'stats' ? 'active' : ''} onClick={() => setMode('stats')}>
          統計
        </button>
      </div>

      {mode === 'list' ? (
        <>
          {usedCats.length > 1 && (
            <div className="chips">
              <button className={`chip${filter === 'all' ? ' selected' : ''}`} onClick={() => setFilter('all')}>
                全部
              </button>
              {usedCats.map((c) => (
                <button key={c.id} className={`chip${filter === c.id ? ' selected' : ''}`} onClick={() => setFilter(c.id)}>
                  {c.emoji} {c.name}
                </button>
              ))}
            </div>
          )}
          {byDate.size === 0 ? (
            <div className="empty-box">
              <p>這個月還沒有記錄</p>
            </div>
          ) : (
            [...byDate.entries()].map(([date, items]) => (
              <div key={date}>
                <div className="day-group">
                  <span>{fmtDateLabel(date)}</span>
                  <span>{fmtTWD(items.reduce((a, e) => a + e.amount, 0))}</span>
                </div>
                <div className="money-list">
                  {items.map((e) => {
                    const c = catOf(e.cat);
                    return (
                      <button key={e.id} className="money-row" onClick={() => setEditing(e)}>
                        <span className="money-emoji">{c.emoji}</span>
                        <span className="money-main">
                          <span className="money-title">{e.item || c.name}</span>
                          <span className="money-sub">
                            {c.name}
                            {e.meal ? `・${MEALS[e.meal]}` : ''}
                            {e.payWith ? ` · ${payLabel(e.payWith, payNames)}` : ''}
                            {e.note ? ` · ${e.note}` : ''}
                          </span>
                        </span>
                        <span className="money-amt">{fmtTWD(e.amount)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </>
      ) : (
        <LedgerStats month={month} list={list} cats={cats} payNames={payNames} />
      )}

      <button className="fab" onClick={() => setEditing({})} aria-label="記一筆">
        <IconPlus size={26} />
      </button>
      {editing && <ExpenseSheet initial={editing} cats={cats} onClose={() => setEditing(null)} onSaved={say} />}
      {toast}
    </>
  );
}

function LedgerStats({ month, list, cats, payNames }: { month: string; list: Expense[]; cats: ExpenseCat[]; payNames: Map<string, string> }) {
  const settings = useSettings();
  const [withSubs, setWithSubs] = useState(true);
  const subs = useLiveQuery(() => db.subscriptions.toArray()) ?? [];
  const { from, to } = monthRange(month);
  const rate = settings.usdRate ?? DEFAULT_USD_RATE;

  // 本月的訂閱扣款
  const subCharges: { date: string; amount: number; name: string }[] = [];
  if (withSubs) {
    for (const s of subs) {
      if (s.status === 'cancelled' || !s.amount) continue;
      const d = nextCharge(s, from);
      if (d && d <= to) subCharges.push({ date: d, amount: chargeTWD(s, rate), name: s.name });
    }
  }
  const total = list.reduce((a, e) => a + e.amount, 0) + subCharges.reduce((a, s) => a + s.amount, 0);
  const days = Number(to.slice(8));
  const daily = Array.from({ length: days }, (_, i) => ({
    label: fmtDateLabel(`${month}-${String(i + 1).padStart(2, '0')}`),
    short: [1, 5, 10, 15, 20, 25, days].includes(i + 1) ? String(i + 1) : '',
    value: 0,
  }));
  for (const e of list) daily[Number(e.date.slice(8)) - 1].value += e.amount;
  for (const s of subCharges) daily[Number(s.date.slice(8)) - 1].value += s.amount;

  const today = todayKey();
  const elapsed = today >= from && today <= to ? Number(today.slice(8)) : days;
  const catRows = cats
    .map((c) => ({ key: c.id, label: `${c.emoji} ${c.name}`, value: list.filter((e) => e.cat === c.id).reduce((a, e) => a + e.amount, 0), color: c.color }))
    .concat(withSubs ? [{ key: '__sub', label: '🔁 訂閱', value: subCharges.reduce((a, s) => a + s.amount, 0), color: '#b38b8b' }] : [])
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const food = list.filter((e) => e.cat === 'food');
  const meal = (m: Meal) => food.filter((e) => (e.meal ?? 'meal') === m);
  const top = new Map<string, { name: string; meal: Meal; n: number; sum: number }>();
  for (const e of food) {
    const k = `${e.meal}|${e.item || '（未命名）'}`;
    const t = top.get(k) ?? { name: e.item || '（未命名）', meal: e.meal ?? 'meal', n: 0, sum: 0 };
    t.n++;
    t.sum += e.amount;
    top.set(k, t);
  }

  return (
    <>
      <label className="toggle-row">
        <input type="checkbox" checked={withSubs} onChange={(e) => setWithSubs(e.target.checked)} />
        <span>包含訂閱扣款</span>
      </label>
      <div className="stat-line">
        總支出 <b>{fmtTWD(total)}</b> · 日平均 <b>{fmtTWD(total / Math.max(1, elapsed))}</b>
      </div>
      <h3>每日支出</h3>
      <div className="card chart-card">
        <BarChart bars={daily} format={fmtTWD} empty="這個月沒有支出" />
      </div>
      <h3>分類</h3>
      <HBarList rows={catRows.map((r) => ({ ...r, sub: total ? `${Math.round((r.value / total) * 100)}%` : '' }))} format={fmtTWD} />
      <h3>付款方式</h3>
      <HBarList
        rows={[...list
          .reduce((m, e) => m.set(e.payWith ?? '', (m.get(e.payWith ?? '') ?? 0) + e.amount), new Map<string, number>())
          .entries()]
          .map(([k, v]) => ({ key: k || 'none', label: k ? payLabel(k, payNames) : '未標記', value: v }))
          .sort((a, b) => b.value - a.value)}
        format={fmtTWD}
      />
      <h3>餐飲：正餐 vs 點心</h3>
      {food.length === 0 ? (
        <p className="muted">這個月沒有餐飲紀錄</p>
      ) : (
        <>
          <div className="meal-split">
            {(['meal', 'snack'] as Meal[]).map((m) => {
              const l = meal(m);
              const sum = l.reduce((a, e) => a + e.amount, 0);
              return (
                <div key={m}>
                  <span>{MEALS[m]}</span>
                  <b>{fmtTWD(sum)}</b>
                  <small className="muted">
                    {l.length} 筆 · 平均 {fmtTWD(l.length ? sum / l.length : 0)}
                  </small>
                </div>
              );
            })}
          </div>
          <h3>最常吃</h3>
          <div className="money-list">
            {[...top.values()]
              .sort((a, b) => b.n - a.n || b.sum - a.sum)
              .slice(0, 6)
              .map((t) => (
                <div key={`${t.meal}${t.name}`} className="money-row static">
                  <span className="money-main">
                    <span className="money-title">{t.name}</span>
                    <span className="money-sub">{MEALS[t.meal]}</span>
                  </span>
                  <span className="money-amt">
                    ×{t.n} · {fmtTWD(t.sum)}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </>
  );
}

export function ExpenseSheet({ initial, cats, onClose, onSaved }: { initial: Partial<Expense>; cats: ExpenseCat[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount) : '');
  const [cat, setCat] = useState(initial.cat ?? 'food');
  const [meal, setMeal] = useState<Meal>(initial.meal ?? guessMeal());
  const [item, setItem] = useState(initial.item ?? '');
  const [date, setDate] = useState(initial.date ?? todayKey());
  const [note, setNote] = useState(initial.note ?? '');
  const [manage, setManage] = useState(false);
  const [autoFilled, setAutoFilled] = useState<string | null>(null);
  const [error, setError] = useState('');
  const settings = useSettings();
  const [payWith, setPayWith] = useState<string | undefined>(initial.id ? initial.payWith : undefined);
  const [adding, setAdding] = useState(false);
  const [newPay, setNewPay] = useState('');
  const options = useLiveQuery(() => payOptions()) ?? [];
  const payNames = usePayNames();
  // 新的一筆預設用上次的付款方式（還存在的話），否則現金
  const chosen = payWith ?? (options.some((o) => o.value === settings.lastPayWith) ? settings.lastPayWith : CASH);
  // 編輯時，原本的付款方式即使已經不在清單（例如禮券用完）也要顯示
  const shownOptions =
    chosen && !options.some((o) => o.value === chosen)
      ? [...options, { value: chosen, label: payLabel(chosen, payNames), deducts: false }]
      : options;
  const chosenOpt = shownOptions.find((o) => o.value === chosen);
  const m = cat === 'food' ? meal : undefined;
  const quick = sortQuickItems(useLiveQuery(() => db.quickItems.where('cat').equals(cat).toArray(), [cat]) ?? []).filter((q) => q.meal === m);

  function pick(q: { item: string; amount: number }) {
    setItem(q.item);
    if (q.amount && (!amount || amount === autoFilled)) {
      setAmount(String(q.amount));
      setAutoFilled(String(q.amount));
    }
  }

  async function save() {
    const v = numOrUndef(amount);
    if (!v || v <= 0) return setError('請輸入金額');
    await saveExpense({ id: initial.id, date, amount: v, cat, meal: m, item, note, payWith: chosen });
    onSaved(`已記錄 ${fmtTWD(v)}${chosenOpt?.deducts ? `，已從${chosenOpt.label}扣款` : ''}`);
    onClose();
  }

  async function remove() {
    if (!initial.id || !confirm(`刪除這筆支出？${initial.deducted ? '\n扣掉的帳戶或禮券餘額會還原。' : ''}`)) return;
    await deleteExpense(initial.id);
    onClose();
  }

  return (
    <Sheet
      title={initial.id ? '編輯支出' : '記一筆'}
      onClose={onClose}
      actions={
        <>
          {initial.id ? (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          )}
          <button className="btn primary" onClick={save}>
            儲存
          </button>
        </>
      }
    >
      <label className="field">
        <span>金額（NT$）</span>
        <input className="amount-input" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus={!initial.id} />
      </label>
      <div className="cat-grid">
        {cats.map((c) => (
          <button key={c.id} className={`cat-btn${cat === c.id ? ' selected' : ''}`} style={{ ['--c' as string]: c.color }} onClick={() => setCat(c.id)}>
            <span>{c.emoji}</span>
            {c.name}
          </button>
        ))}
      </div>
      {cat === 'food' && (
        <div className="segmented">
          {(['meal', 'snack'] as Meal[]).map((x) => (
            <button key={x} className={meal === x ? 'active' : ''} onClick={() => setMeal(x)}>
              {x === 'meal' ? '🍚 正餐' : '🧋 點心'}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>品項</span>
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          onBlur={() => {
            const q = quick.find((x) => x.id === quickId(cat, m, item.trim()));
            if (q) pick(q);
          }}
          placeholder={cat === 'food' ? (meal === 'meal' ? '例如：排骨便當' : '例如：珍奶') : '例如：捷運、衛生紙'}
        />
      </label>
      {quick.length > 0 && (
        <>
          <div className="group-label">
            <span>常用（點一下帶入）</span>
            <button className="group-add" onClick={() => setManage(!manage)}>
              {manage ? '完成' : '編輯'}
            </button>
          </div>
          <div className="chips">
            {quick.slice(0, 15).map((q) => (
              <button
                key={q.id}
                className={`chip${manage ? ' removing' : ''}`}
                onClick={() => (manage ? void db.quickItems.delete(q.id) : pick(q))}
              >
                {q.item}
                {q.amount ? <small className="muted"> ${fmtNum(q.amount)}</small> : null}
                {manage && ' ×'}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="field">
        <span>日期</span>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <small className="muted">{fmtDateLabel(date)}</small>
      </label>
      <div className="field">
        <span>付款方式</span>
        <div className="chips">
          {shownOptions.map((o) => (
            <button key={o.value} className={`chip${chosen === o.value ? ' selected' : ''}`} onClick={() => setPayWith(o.value)}>
              {o.label}
            </button>
          ))}
          <button className="chip" onClick={() => setAdding(!adding)}>
            ＋ 信用卡／支付
          </button>
        </div>
        {adding && (
          <div className="add-pay">
            <input value={newPay} onChange={(e) => setNewPay(e.target.value)} placeholder="例如：國泰 CUBE 卡、LINE Pay" autoFocus />
            {(['card', 'epay'] as const).map((k) => (
              <button
                key={k}
                className="btn sm"
                disabled={!newPay.trim()}
                onClick={async () => {
                  setPayWith(await addPayMethod(newPay, k));
                  setNewPay('');
                  setAdding(false);
                }}
              >
                {k === 'card' ? '信用卡' : '電子支付'}
              </button>
            ))}
          </div>
        )}
        {chosenOpt && <small className="muted">{chosenOpt.deducts ? `儲存後會${chosenOpt.hint}` : chosen === CASH ? '只標記，不扣任何餘額' : `${chosenOpt.hint ?? ''}：只標記，不扣餘額`}</small>}
        {chosen?.startsWith('pay:') && (
          <button
            className="text-btn left"
            onClick={async () => {
              if (!confirm(`從清單移除「${chosenOpt?.label}」？之前用它記的支出會顯示「（已刪除）」。`)) return;
              await removePayMethod(chosen.slice(4));
              setPayWith(CASH);
            }}
          >
            從清單移除這個付款方式
          </button>
        )}
      </div>
      <label className="field">
        <span>備註（選填）</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="error">{error}</div>}
      {dayStart(date) > Date.now() && <div className="warn">日期在未來，確定嗎？</div>}
    </Sheet>
  );
}
