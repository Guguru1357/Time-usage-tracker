import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, uid, type Subscription } from '../db';
import { useSettings } from '../hooks';
import { updateSettings } from '../repo';
import { addDays, dayStart, fmtDateLabel, todayKey } from '../time';
import { DEFAULT_USD_RATE, SUB_CATEGORIES, SUB_STATUS, chargeTWD, ensureDefaultSubs, fmtTWD, monthlyTWD, needsSetup, nextCharge } from './money';
import { Sheet, numOrUndef, useToast } from './ui';

export function SubsPage() {
  const settings = useSettings();
  const rate = settings.usdRate ?? DEFAULT_USD_RATE;
  const subs = useLiveQuery(() => db.subscriptions.toArray()) ?? [];
  const [editing, setEditing] = useState<Partial<Subscription> | null>(null);
  const [review, setReview] = useState<{ queue: string[]; idx: number } | null>(null);
  const [, say, toast] = useToast();
  useEffect(() => void ensureDefaultSubs(), []);

  const today = todayKey();
  const counted = subs.filter((s) => s.status !== 'cancelled');
  const monthly = counted.reduce((a, s) => a + monthlyTWD(s, rate), 0);
  const considering = counted.filter((s) => s.status === 'considering');
  const saving = considering.reduce((a, s) => a + monthlyTWD(s, rate) * 12, 0);
  const withNext = subs
    .map((s) => ({ s, next: s.status === 'cancelled' ? undefined : nextCharge(s, today) }))
    .sort((a, b) => Number(a.s.status === 'cancelled') - Number(b.s.status === 'cancelled') || (a.next ?? '9999').localeCompare(b.next ?? '9999'));
  const upcoming = withNext.filter((x) => x.next && x.next <= addDays(today, 7));

  if (review) {
    const s = subs.find((x) => x.id === review.queue[review.idx]);
    const done = review.idx >= review.queue.length;
    const answer = async (used: boolean | null) => {
      if (s && used !== null) {
        await db.subscriptions.update(s.id, {
          lastReviewed: today,
          status: used ? (s.status === 'considering' ? 'active' : s.status) : 'considering',
        });
      }
      setReview({ ...review, idx: review.idx + 1 });
    };
    return (
      <div className="review-box">
        {done || !s ? (
          <>
            <h2>審視完成</h2>
            <p>考慮取消的 {considering.length} 項，全部取消後每年可省</p>
            <div className="big-total">
              <b>{fmtTWD(saving)}</b>
            </div>
            <button className="btn primary block" onClick={() => setReview(null)}>
              完成
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              {review.idx + 1} / {review.queue.length}
            </p>
            <h2>{s.name}</h2>
            <p>{s.amount ? `${s.currency === 'USD' ? 'US$' : 'NT$'}${s.amount} / ${s.cycle === 'yearly' ? '年' : '月'}` : '金額未填'}</p>
            <p className="ok-text">取消後每年可省 {fmtTWD(monthlyTWD(s, rate) * 12)}</p>
            <h3 className="question">上個月有用嗎？</h3>
            <button className="btn primary block" onClick={() => void answer(true)}>
              有用，繼續訂
            </button>
            <button className="btn block" onClick={() => void answer(false)}>
              沒用，考慮取消
            </button>
            <button className="btn ghost block" onClick={() => void answer(null)}>
              跳過
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="two-totals">
        <div>
          <span>每月訂閱</span>
          <b>{fmtTWD(monthly)}</b>
        </div>
        <div>
          <span>每年訂閱</span>
          <b>{fmtTWD(monthly * 12)}</b>
        </div>
      </div>
      {considering.length > 0 && <p className="muted">考慮取消 {considering.length} 項，取消後每年可省 {fmtTWD(saving)}</p>}

      <h3>7 天內扣款</h3>
      {upcoming.length === 0 ? (
        <p className="muted">7 天內沒有扣款</p>
      ) : (
        <div className="money-list">
          {upcoming.map(({ s, next }) => {
            const n = Math.round((dayStart(next!) - dayStart(today)) / 86_400_000);
            return (
              <button key={s.id} className="money-row" onClick={() => setEditing(s)}>
                <span className="money-main">
                  <span className="money-title">{s.name}</span>
                  <span className="money-sub">
                    {fmtDateLabel(next!)} · {n === 0 ? '今天' : n === 1 ? '明天' : `${n} 天後`}
                    {s.payment ? ` · ${s.payment}` : ''}
                  </span>
                </span>
                <span className="money-amt">{fmtTWD(chargeTWD(s, rate))}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="section-head">
        <h3>全部訂閱</h3>
        <button className="text-btn" onClick={() => setEditing({})}>
          ＋ 新增
        </button>
      </div>
      <div className="money-list">
        {withNext.map(({ s, next }) => (
          <button key={s.id} className={`money-row${s.status === 'cancelled' ? ' faded' : ''}`} onClick={() => setEditing(s)}>
            <span className="money-main">
              <span className="money-title">
                {s.name}
                {s.status !== 'active' && <span className="tag">{SUB_STATUS[s.status]}</span>}
                {s.status !== 'cancelled' && needsSetup(s) && <span className="tag">待填</span>}
              </span>
              <span className="money-sub">
                {SUB_CATEGORIES[s.category]} · {s.cycle === 'yearly' ? '年繳' : '月繳'}
                {next ? ` · 下次 ${fmtDateLabel(next)}` : ''}
              </span>
            </span>
            <span className="money-amt">
              {s.amount ? `${s.currency === 'USD' ? 'US$' : 'NT$'}${s.amount}` : '—'}
              {s.amount > 0 && (s.cycle === 'yearly' || s.currency === 'USD') && <small>≈ {fmtTWD(monthlyTWD(s, rate))}/月</small>}
            </span>
          </button>
        ))}
      </div>

      <button className="btn block" onClick={() => setReview({ queue: counted.map((s) => s.id), idx: 0 })} disabled={!counted.length}>
        🔍 審視模式：逐筆問「上個月有用嗎？」
      </button>
      <label className="field">
        <span>USD → TWD 匯率</span>
        <input
          type="number"
          inputMode="decimal"
          defaultValue={rate}
          onBlur={(e) => {
            const v = numOrUndef(e.target.value);
            if (v && v > 0) void updateSettings({ usdRate: v });
          }}
        />
      </label>

      {editing && <SubSheet initial={editing} rate={rate} onClose={() => setEditing(null)} onSaved={say} />}
      {toast}
    </>
  );
}

function SubSheet({ initial, rate, onClose, onSaved }: { initial: Partial<Subscription>; rate: number; onClose: () => void; onSaved: (m: string) => void }) {
  const [s, setS] = useState<Partial<Subscription>>({ currency: 'TWD', cycle: 'monthly', category: 'other', status: 'active', ...initial });
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount) : '');
  const set = (patch: Partial<Subscription>) => setS((x) => ({ ...x, ...patch }));
  const preview = { ...s, amount: numOrUndef(amount) ?? 0 } as Subscription;

  async function save() {
    if (!s.name?.trim()) return;
    await db.subscriptions.put({
      id: s.id ?? uid(),
      name: s.name.trim(),
      amount: numOrUndef(amount) ?? 0,
      currency: s.currency!,
      cycle: s.cycle!,
      billingDay: s.billingDay,
      billingMonth: s.cycle === 'yearly' ? s.billingMonth : undefined,
      payment: s.payment?.trim() || undefined,
      category: s.category!,
      status: s.status!,
      lastReviewed: s.lastReviewed,
    });
    onSaved('已儲存');
    onClose();
  }
  async function remove() {
    if (!s.id || !confirm(`刪除「${s.name}」？不用了的話建議改成「已取消」保留紀錄。`)) return;
    await db.subscriptions.delete(s.id);
    onClose();
  }

  return (
    <Sheet
      title={s.id ? '編輯訂閱' : '新增訂閱'}
      onClose={onClose}
      actions={
        <>
          {s.id ? (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!s.name?.trim()}>
            儲存
          </button>
        </>
      }
    >
      <label className="field">
        <span>名稱</span>
        <input value={s.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="two-col">
        <label className="field">
          <span>金額</span>
          <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
        <div className="field">
          <span>幣別</span>
          <div className="segmented">
            {(['TWD', 'USD'] as const).map((c) => (
              <button key={c} className={s.currency === c ? 'active' : ''} onClick={() => set({ currency: c })}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="segmented">
        <button className={s.cycle === 'monthly' ? 'active' : ''} onClick={() => set({ cycle: 'monthly' })}>
          月繳
        </button>
        <button className={s.cycle === 'yearly' ? 'active' : ''} onClick={() => set({ cycle: 'yearly' })}>
          年繳
        </button>
      </div>
      <div className="two-col">
        {s.cycle === 'yearly' && (
          <label className="field">
            <span>扣款月份</span>
            <select value={s.billingMonth ?? ''} onChange={(e) => set({ billingMonth: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">未設定</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} 月
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>扣款日</span>
          <select value={s.billingDay ?? ''} onChange={(e) => set({ billingDay: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">未設定</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1} 日
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>付款方式（選填）</span>
        <input value={s.payment ?? ''} onChange={(e) => set({ payment: e.target.value })} placeholder="例如：國泰 *1234" />
      </label>
      <div className="field">
        <span>分類</span>
        <div className="chips">
          {(Object.keys(SUB_CATEGORIES) as Subscription['category'][]).map((c) => (
            <button key={c} className={`chip${s.category === c ? ' selected' : ''}`} onClick={() => set({ category: c })}>
              {SUB_CATEGORIES[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>狀態</span>
        <div className="chips">
          {(Object.keys(SUB_STATUS) as Subscription['status'][]).map((c) => (
            <button key={c} className={`chip${s.status === c ? ' selected' : ''}`} onClick={() => set({ status: c })}>
              {SUB_STATUS[c]}
            </button>
          ))}
        </div>
      </div>
      {preview.amount > 0 && (
        <p className="muted small">
          每月平均 {fmtTWD(monthlyTWD(preview, rate))}，每年 {fmtTWD(monthlyTWD(preview, rate) * 12)}
          {s.currency === 'USD' ? `（匯率 ${rate}）` : ''}
        </p>
      )}
    </Sheet>
  );
}
