import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, type Account, type Income } from '../db';
import { rescheduleReminders } from '../notifications';
import { fmtDateLabel, todayKey } from '../time';
import { useSettings } from '../hooks';
import {
  ACCOUNT_KINDS,
  CURRENCIES,
  INCOME_KINDS,
  addIncome,
  balancesAt,
  currencyInfo,
  currencyOf,
  fmtMoney,
  rateOf,
  salaryInMonth,
  saveAccount,
  setBalance,
  setRate,
  totalAt,
} from './assets';
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
  const settings = useSettings();
  const rates = (code: string) => rateOf(code, settings);

  // 從薪資通知進來時直接打開輸入畫面
  useEffect(() => {
    if (openIncome) setIncome(true);
  }, [openIncome]);

  const today = todayKey();
  const current = balancesAt(balances);
  const month = today.slice(0, 7);
  const totals = totalAt(accounts, balances, rates);
  const total = totals.twd;
  const lastMonthEnd = monthRange(shiftMonth(month, -1)).to;
  const prevTotal = totalAt(accounts, balances, rates, lastMonthEnd).twd;
  // 用到的外幣（台幣以外）
  const foreign = [...new Set(accounts.map(currencyOf))].filter((c) => c !== 'TWD');
  const twdOf = (a: Account) => {
    const b = current.get(a.id);
    const r = rates(currencyOf(a));
    return b && r !== undefined ? b.amount * r : 0;
  };
  const salary = salaryInMonth(incomes, month);

  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(month, i - 11);
    const end = m === month ? today : monthRange(m).to;
    return { label: `${Number(m.slice(0, 4))}/${Number(m.slice(5))}`, short: `${Number(m.slice(5))}`, value: totalAt(accounts, balances, rates, end).twd };
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
        {foreign.length > 0 && <small className="muted">外幣依目前匯率換算成台幣</small>}
        {totals.missing.length > 0 && (
          <div className="warn">還沒設定 {totals.missing.map((c) => currencyInfo(c).name).join('、')} 的匯率，這些帳戶沒有算進總資產</div>
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
            const cur = currencyOf(a);
            const r = rates(cur);
            return (
              <button key={a.id} className="money-row" onClick={() => setBalanceOf(a)}>
                <span className="money-main">
                  <span className="money-title">{a.name}</span>
                  <span className="money-sub">
                    {ACCOUNT_KINDS[a.kind]}
                    {cur !== 'TWD' ? ` · ${currencyInfo(cur).name}` : ''}
                    {b ? ` · ${fmtDateLabel(b.date)} 更新` : ' · 還沒輸入餘額'}
                  </span>
                </span>
                <span className="money-amt">
                  {b ? fmtMoney(b.amount, cur) : '—'}
                  {b && cur !== 'TWD' && <small>{r !== undefined ? `≈ ${fmtTWD(b.amount * r)}` : '未設匯率'}</small>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {accounts.length > 1 && total > 0 && (
        <>
          <h3>資產分布</h3>
          <HBarList
            rows={accounts.map((a) => ({ key: a.id, label: a.name, value: twdOf(a), sub: `${Math.round((twdOf(a) / total) * 100)}%` }))}
            format={fmtTWD}
          />
        </>
      )}

      {foreign.length > 0 && (
        <>
          <h3>匯率（1 外幣 = 多少台幣）</h3>
          <div className="money-list">
            {foreign.map((c) => (
              <div key={c} className="money-row static rate-row">
                <span className="money-main">
                  <span className="money-title">
                    1 {currencyInfo(c).name}（{c}）
                  </span>
                </span>
                <span className="rate-input">
                  =
                  <input
                    key={`${c}-${rates(c) ?? ''}`}
                    type="number"
                    inputMode="decimal"
                    defaultValue={rates(c) ?? ''}
                    placeholder="輸入"
                    onBlur={async (e) => {
                      const v = numOrUndef(e.target.value);
                      if (v && v > 0 && v !== rates(c)) {
                        await setRate(c, v, today);
                        say(`${currencyInfo(c).name}匯率已更新`);
                      }
                    }}
                  />
                  台幣
                </span>
              </div>
            ))}
          </div>
          <p className="muted small">
            {settings.fxUpdated ? `最後更新：${fmtDateLabel(settings.fxUpdated)}。` : ''}可以看銀行 App 的牌告匯率填入；美元匯率和訂閱共用。
          </p>
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
      {income && <IncomeSheet accounts={accounts.filter((a) => currencyOf(a) === 'TWD')} onClose={() => setIncome(false)} onSaved={say} />}
      {toast}
    </>
  );
}

function AccountSheet({ initial, onClose }: { initial: Partial<Account>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [kind, setKind] = useState<Account['kind']>(initial.kind ?? 'bank');
  const [currency, setCurrency] = useState(currencyOf(initial));
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) return setError('請輸入名稱，例如：郵局、國泰世華');
    const id = await saveAccount({ id: initial.id, name: name.trim(), kind, currency: currency === 'TWD' ? undefined : currency });
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：郵局、國泰世華、國泰 美元帳戶" />
      </label>
      <div className="field">
        <span>幣別</span>
        <div className="chips">
          {CURRENCIES.map((c) => (
            <button key={c.code} className={`chip${currency === c.code ? ' selected' : ''}`} onClick={() => setCurrency(c.code)}>
              {c.name}
            </button>
          ))}
        </div>
        {initial.id && currency !== currencyOf(initial) && <small className="warn">改幣別不會換算舊的餘額，請之後重新輸入一次餘額</small>}
      </div>
      {!initial.id && (
        <label className="field">
          <span>目前餘額（{currencyInfo(currency).name}，選填）</span>
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
    onSaved(`${account.name} 已更新為 ${fmtMoney(v, currencyOf(account))}`);
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
        <b>{history[0] ? fmtMoney(history[0].amount, currencyOf(account)) : '—'}</b>
      </div>
      <label className="field">
        <span>新的餘額（{currencyInfo(currencyOf(account)).name}，看存摺或網銀輸入）</span>
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
                    {prev && <span className="money-sub">{diff >= 0 ? '+' : '−'}{fmtMoney(Math.abs(diff), currencyOf(account))}</span>}
                  </span>
                  <span className="money-amt">{fmtMoney(b.amount, currencyOf(account))}</span>
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
