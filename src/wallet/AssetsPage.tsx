import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, type Account, type Income } from '../db';
import { rescheduleReminders } from '../notifications';
import { fmtDateLabel, todayKey } from '../time';
import { ACCOUNT_KINDS, INCOME_KINDS, addIncome, balancesAt, salaryInMonth, saveAccount, setBalance, totalAt } from './assets';
import { fmtTWD, monthRange, shiftMonth } from './money';
import { BarChart, HBarList, Sheet, numOrUndef, useToast } from './ui';

export function AssetsPage({ openIncome }: { openIncome?: number }) {
  const accounts = (useLiveQuery(() => db.accounts.orderBy('order').toArray()) ?? []).filter((a) => !a.archived);
  const balances = useLiveQuery(() => db.balances.toArray()) ?? [];
  const incomes = useLiveQuery(() => db.incomes.orderBy('date').reverse().toArray()) ?? [];
  const [editAccount, setEditAccount] = useState<Partial<Account> | null>(null);
  const [balanceOf, setBalanceOf] = useState<Account | null>(null);
  const [income, setIncome] = useState(false);
  const [, say, toast] = useToast();

  // 從薪資通知進來時直接打開輸入畫面
  useEffect(() => {
    if (openIncome) setIncome(true);
  }, [openIncome]);

  const today = todayKey();
  const month = today.slice(0, 7);
  const total = totalAt(accounts, balances);
  const lastMonthEnd = monthRange(shiftMonth(month, -1)).to;
  const prevTotal = totalAt(accounts, balances, lastMonthEnd);
  const current = balancesAt(balances);
  const salary = salaryInMonth(incomes, month);

  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(month, i - 11);
    const end = m === month ? today : monthRange(m).to;
    return { label: `${Number(m.slice(0, 4))}/${Number(m.slice(5))}`, short: `${Number(m.slice(5))}`, value: totalAt(accounts, balances, end) };
  });

  return (
    <>
      <div className="big-total">
        <span>總資產</span>
        <b>{fmtTWD(total)}</b>
        {prevTotal > 0 && (
          <small className="muted">
            比上月底 {total >= prevTotal ? '+' : '−'}
            {fmtTWD(Math.abs(total - prevTotal))}
          </small>
        )}
      </div>

      <button className={`salary-card${salary.length ? ' done' : ''}`} onClick={() => setIncome(true)}>
        <span>
          <b>{Number(month.slice(5))} 月薪資</b>
          <small>{salary.length ? `已記錄 ${fmtTWD(salary.reduce((a, s) => a + s.amount, 0))}` : '還沒記錄，點這裡輸入'}</small>
        </span>
        <span className="salary-mark">{salary.length ? '✓' : '＋'}</span>
      </button>

      <div className="section-head">
        <h3>帳戶</h3>
        <button className="text-btn" onClick={() => setEditAccount({ kind: 'bank' })}>
          ＋ 新增帳戶
        </button>
      </div>
      {accounts.length === 0 ? (
        <div className="empty-box">
          <p>先新增郵局、銀行帳戶，再輸入目前餘額</p>
        </div>
      ) : (
        <div className="money-list">
          {accounts.map((a) => {
            const b = current.get(a.id);
            return (
              <button key={a.id} className="money-row" onClick={() => setBalanceOf(a)}>
                <span className="money-main">
                  <span className="money-title">{a.name}</span>
                  <span className="money-sub">
                    {ACCOUNT_KINDS[a.kind]}
                    {b ? ` · ${fmtDateLabel(b.date)} 更新` : ' · 還沒輸入餘額'}
                  </span>
                </span>
                <span className="money-amt">{b ? fmtTWD(b.amount) : '—'}</span>
              </button>
            );
          })}
        </div>
      )}

      {accounts.length > 1 && total > 0 && (
        <>
          <h3>資產分布</h3>
          <HBarList
            rows={accounts.map((a) => ({ key: a.id, label: a.name, value: current.get(a.id)?.amount ?? 0, sub: `${Math.round(((current.get(a.id)?.amount ?? 0) / total) * 100)}%` }))}
            format={fmtTWD}
          />
        </>
      )}

      <h3>近 12 個月總資產</h3>
      <div className="card chart-card">
        <BarChart bars={trend} format={fmtTWD} empty="輸入帳戶餘額後會顯示" />
      </div>

      <div className="section-head">
        <h3>收入紀錄</h3>
        <button className="text-btn" onClick={() => setIncome(true)}>
          ＋ 記收入
        </button>
      </div>
      {incomes.length === 0 ? (
        <p className="muted">還沒有收入紀錄</p>
      ) : (
        <div className="money-list">
          {incomes.slice(0, 12).map((i) => (
            <div key={i.id} className="money-row static">
              <span className="money-main">
                <span className="money-title">{INCOME_KINDS[i.kind]}</span>
                <span className="money-sub">
                  {fmtDateLabel(i.date)}
                  {i.note ? ` · ${i.note}` : ''}
                </span>
              </span>
              <span className="money-amt plus">+{fmtTWD(i.amount)}</span>
              <button
                className="text-btn"
                aria-label="刪除"
                onClick={async () => {
                  if (!confirm('刪除這筆收入？（帳戶餘額不會跟著改）')) return;
                  await db.incomes.delete(i.id);
                  void rescheduleReminders();
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {editAccount && <AccountSheet initial={editAccount} onClose={() => setEditAccount(null)} />}
      {balanceOf && <BalanceSheet account={balanceOf} onEdit={() => (setEditAccount(balanceOf), setBalanceOf(null))} onClose={() => setBalanceOf(null)} onSaved={say} />}
      {income && <IncomeSheet accounts={accounts} onClose={() => setIncome(false)} onSaved={say} />}
      {toast}
    </>
  );
}

function AccountSheet({ initial, onClose }: { initial: Partial<Account>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [kind, setKind] = useState<Account['kind']>(initial.kind ?? 'bank');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) return setError('請輸入名稱，例如：郵局、國泰世華');
    const id = await saveAccount({ id: initial.id, name: name.trim(), kind });
    const v = numOrUndef(amount);
    if (!initial.id && v !== undefined) await setBalance(id, v, todayKey());
    onClose();
  }
  async function remove() {
    if (!initial.id || !confirm(`刪除帳戶「${initial.name}」？總資產將不再計入，過去紀錄會保留。`)) return;
    await db.accounts.update(initial.id, { archived: true });
    onClose();
  }

  return (
    <Sheet
      title={initial.id ? '編輯帳戶' : '新增帳戶'}
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
      <div className="chips">
        {(Object.keys(ACCOUNT_KINDS) as Account['kind'][]).map((k) => (
          <button
            key={k}
            className={`chip${kind === k ? ' selected' : ''}`}
            onClick={() => {
              setKind(k);
              if (!name.trim() && (k === 'post' || k === 'cash')) setName(ACCOUNT_KINDS[k]);
            }}
          >
            {ACCOUNT_KINDS[k]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>名稱</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：郵局、國泰世華、台新 Richart" />
      </label>
      {!initial.id && (
        <label className="field">
          <span>目前餘額（選填）</span>
          <input type="number" inputMode="decimal" className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
      )}
      {error && <div className="error">{error}</div>}
    </Sheet>
  );
}

function BalanceSheet({ account, onEdit, onClose, onSaved }: { account: Account; onEdit: () => void; onClose: () => void; onSaved: (m: string) => void }) {
  const history = (useLiveQuery(() => db.balances.where('accountId').equals(account.id).toArray(), [account.id]) ?? []).sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
  );
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKey());

  async function save() {
    const v = numOrUndef(amount);
    if (v === undefined) return;
    await setBalance(account.id, v, date);
    onSaved(`${account.name} 已更新為 ${fmtTWD(v)}`);
    onClose();
  }

  return (
    <Sheet
      title={account.name}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onEdit}>
            編輯帳戶
          </button>
          <button className="btn primary" onClick={save} disabled={numOrUndef(amount) === undefined}>
            更新餘額
          </button>
        </>
      }
    >
      <div className="big-total small">
        <span>目前餘額</span>
        <b>{history[0] ? fmtTWD(history[0].amount) : '—'}</b>
      </div>
      <label className="field">
        <span>新的餘額（看存摺或網銀輸入）</span>
        <input type="number" inputMode="decimal" className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={history[0] ? String(history[0].amount) : '0'} autoFocus />
      </label>
      <label className="field">
        <span>日期</span>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      {history.length > 0 && (
        <>
          <div className="section-label">歷史</div>
          <div className="money-list">
            {history.slice(0, 12).map((b, i) => {
              const prev = history[i + 1];
              const diff = prev ? b.amount - prev.amount : 0;
              return (
                <div key={b.id} className="money-row static">
                  <span className="money-main">
                    <span className="money-title">{fmtDateLabel(b.date)}</span>
                    {prev && <span className="money-sub">{diff >= 0 ? `+${fmtTWD(diff)}` : `−${fmtTWD(-diff)}`}</span>}
                  </span>
                  <span className="money-amt">{fmtTWD(b.amount)}</span>
                  <button className="text-btn" aria-label="刪除" onClick={() => confirm('刪除這筆餘額紀錄？') && void db.balances.delete(b.id)}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

function IncomeSheet({ accounts, onClose, onSaved }: { accounts: Account[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<Income['kind']>('salary');
  const [date, setDate] = useState(todayKey());
  const [accountId, setAccountId] = useState<string | undefined>(accounts[0]?.id);
  const [addTo, setAddTo] = useState(true);
  const [note, setNote] = useState('');

  async function save() {
    const v = numOrUndef(amount);
    if (!v || v <= 0) return;
    await addIncome({ date, amount: v, kind, accountId, note: note.trim() || undefined }, addTo);
    void rescheduleReminders();
    onSaved(`已記錄${INCOME_KINDS[kind]} ${fmtTWD(v)}`);
    onClose();
  }

  return (
    <Sheet
      title="記收入"
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save} disabled={!numOrUndef(amount)}>
            儲存
          </button>
        </>
      }
    >
      <div className="segmented">
        {(Object.keys(INCOME_KINDS) as Income['kind'][]).map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {INCOME_KINDS[k]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>金額（NT$）</span>
        <input type="number" inputMode="decimal" className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
      </label>
      <label className="field">
        <span>日期</span>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      {accounts.length > 0 && (
        <div className="field">
          <span>入帳帳戶</span>
          <div className="chips">
            {accounts.map((a) => (
              <button key={a.id} className={`chip${accountId === a.id ? ' selected' : ''}`} onClick={() => setAccountId(a.id)}>
                {a.name}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={addTo} onChange={(e) => setAddTo(e.target.checked)} />
            <span>同時加到這個帳戶的餘額</span>
          </label>
        </div>
      )}
      <label className="field">
        <span>備註（選填）</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Sheet>
  );
}
