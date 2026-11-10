import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, uid, type GiftCard } from '../db';
import { fmtDateLabel, todayKey } from '../time';
import { GIFT_PRESETS, addGiftLog, fmtNum, fmtTWD, giftBalance, giftCount, giftDaysLeft, giftFmt, giftTotal, isCountable, round2 } from './money';
import { Sheet, numOrUndef, useToast } from './ui';

const KIND_LABEL = { init: '建立', use: '使用', add: '加值', set: '調整' };

/** 不足一張的零頭（例如用禮券付了 85 元，剩 15 元） */
function remainder(g: GiftCard): number {
  return round2(giftBalance(g) - giftCount(g) * (g.denom ?? 0));
}

export function GiftsPage() {
  const cards = useLiveQuery(() => db.giftCards.toArray()) ?? [];
  const [editing, setEditing] = useState<Partial<GiftCard> | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [showUsed, setShowUsed] = useState(false);
  const [, say, toast] = useToast();
  const today = todayKey();

  const sorted = [...cards].sort((a, b) => (giftDaysLeft(a, today) ?? 1e9) - (giftDaysLeft(b, today) ?? 1e9) || b.created - a.created);
  const active = sorted.filter((g) => giftBalance(g) > 0);
  const used = sorted.filter((g) => giftBalance(g) <= 0);
  const total = active.filter((g) => g.unit === 'money').reduce((a, g) => a + giftBalance(g), 0);

  async function useOne(g: GiftCard) {
    await addGiftLog(g, { date: today, amount: -g.denom!, kind: 'use', note: '1 張' });
    say(`用了 1 張，還剩 ${giftCount(g) - 1} 張`);
  }

  const row = (g: GiftCard) => {
    const bal = giftBalance(g);
    const days = giftDaysLeft(g, today);
    const sub = [
      isCountable(g) ? `${fmtNum(g.denom!)} 元 × ${giftCount(g)} 張${remainder(g) ? `＋餘額 ${fmtNum(remainder(g))}` : ''}` : '',
      g.expiry ? `${g.expiry.replaceAll('-', '/')} 到期` : '',
      g.place ? `放在${g.place}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div key={g.id} className="gift-row">
        <button className={`money-row${bal <= 0 ? ' faded' : ''}`} onClick={() => setDetail(g.id)}>
          <span className="money-emoji">{g.emoji}</span>
          <span className="money-main">
            <span className="money-title">
              {g.name}
              {bal > 0 && days !== undefined && days <= 30 && <span className="tag warn-tag">{days < 0 ? '已過期' : days === 0 ? '今天到期' : `${days} 天後到期`}</span>}
            </span>
            {sub && <span className="money-sub">{sub}</span>}
          </span>
          <span className="money-amt">{isCountable(g) ? <b className="count-num">{giftCount(g)} 張</b> : giftFmt(g, bal)}</span>
        </button>
        {isCountable(g) && giftCount(g) > 0 && (
          <button className="use-one" onClick={() => void useOne(g)}>
            −1 張
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="big-total">
        <span>禮券總餘額</span>
        <b>{fmtTWD(total)}</b>
        {active.some((g) => g.unit === 'points') && (
          <small className="muted">
            點數另計：
            {active
              .filter((g) => g.unit === 'points')
              .map((g) => `${g.name} ${giftFmt(g, giftBalance(g))}`)
              .join('、')}
          </small>
        )}
      </div>
      {active.length === 0 ? (
        <div className="empty-box">
          <p>還沒有禮券</p>
        </div>
      ) : (
        <div className="gift-list">{active.map(row)}</div>
      )}
      <button className="add-row" onClick={() => setEditing({})}>
        ＋ 新增禮券／點數卡
      </button>
      {used.length > 0 && (
        <>
          <button className="text-btn used-toggle" onClick={() => setShowUsed(!showUsed)}>
            {showUsed ? '▾' : '▸'} 已用完（{used.length}）
          </button>
          {showUsed && <div className="gift-list">{used.map(row)}</div>}
        </>
      )}
      {editing && <GiftSheet initial={editing} onClose={() => setEditing(null)} />}
      {detail && <GiftDetail id={detail} onEdit={(g) => setEditing(g)} onClose={() => setDetail(null)} onSaved={say} />}
      {toast}
    </>
  );
}

function GiftSheet({ initial, onClose }: { initial: Partial<GiftCard>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [emoji, setEmoji] = useState(initial.emoji ?? '🎁');
  const [unit, setUnit] = useState<GiftCard['unit']>(initial.unit ?? 'money');
  const [denom, setDenom] = useState(initial.denom ? String(initial.denom) : '');
  const [count, setCount] = useState('');
  const [amount, setAmount] = useState('');
  const [expiry, setExpiry] = useState(initial.expiry ?? '');
  const [place, setPlace] = useState(initial.place ?? '');
  const isNew = !initial.id;
  const d = numOrUndef(denom);
  const c = numOrUndef(count);
  const total = unit === 'money' && d && c ? d * c : numOrUndef(amount);

  async function save() {
    if (!name.trim()) return;
    const fields = {
      name: name.trim(),
      emoji: [...emoji.trim()].slice(0, 2).join('') || '🎁',
      unit,
      denom: unit === 'money' && d ? d : undefined,
      expiry: expiry || undefined,
      place: place.trim() || undefined,
    };
    if (initial.id) {
      await db.giftCards.update(initial.id, fields);
    } else {
      if (!total || total <= 0) return;
      await db.giftCards.add({ id: uid(), ...fields, created: Date.now(), log: [{ id: uid(), date: todayKey(), amount: round2(total), kind: 'init' }] });
    }
    onClose();
  }
  async function remove() {
    if (!initial.id || !confirm(`刪除「${initial.name}」和所有紀錄？`)) return;
    await db.giftCards.delete(initial.id);
    onClose();
  }

  return (
    <Sheet
      title={isNew ? '新增禮券' : '編輯禮券'}
      onClose={onClose}
      actions={
        <>
          {isNew ? (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          ) : (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          )}
          <button className="btn primary" onClick={save}>
            儲存
          </button>
        </>
      }
    >
      {isNew && (
        <div className="chips">
          {GIFT_PRESETS.map((p) => (
            <button
              key={p.name}
              className="chip"
              onClick={() => {
                setName(p.name);
                setEmoji(p.emoji);
                setUnit(p.unit ?? 'money');
                setDenom(p.denom ? String(p.denom) : '');
              }}
            >
              {p.emoji} {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="habit-name-row">
        <label className="field">
          <span>圖示</span>
          <input className="emoji-input" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </label>
        <label className="field grow">
          <span>名稱</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：7-11 禮券" />
        </label>
      </div>
      <div className="segmented">
        <button className={unit === 'money' ? 'active' : ''} onClick={() => setUnit('money')}>
          金額（禮券）
        </button>
        <button className={unit === 'points' ? 'active' : ''} onClick={() => setUnit('points')}>
          點數（點點卡）
        </button>
      </div>
      {unit === 'money' && (
        <div className="two-col">
          <label className="field">
            <span>每張面額（選填）</span>
            <input type="number" inputMode="numeric" value={denom} onChange={(e) => setDenom(e.target.value)} placeholder="例如 100" />
          </label>
          {isNew && (
            <label className="field">
              <span>張數</span>
              <input type="number" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="例如 20" />
            </label>
          )}
        </div>
      )}
      {isNew && !(unit === 'money' && d && c) && (
        <label className="field">
          <span>{unit === 'points' ? '目前點數' : '總金額'}</span>
          <input type="number" inputMode="decimal" className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
      )}
      {isNew && total ? <p className="muted small">建立後：{unit === 'points' ? `${fmtNum(total)} 點` : fmtTWD(total)}</p> : null}
      <label className="field">
        <span>到期日（選填）</span>
        <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </label>
      <label className="field">
        <span>放在哪裡（選填）</span>
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例如：皮夾、書桌抽屜" />
      </label>
    </Sheet>
  );
}

function GiftDetail({ id, onEdit, onClose, onSaved }: { id: string; onEdit: (g: GiftCard) => void; onClose: () => void; onSaved: (m: string) => void }) {
  const g = useLiveQuery(() => db.giftCards.get(id), [id]);
  const [action, setAction] = useState<'use' | 'add' | 'set' | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  if (!g) return null;
  const bal = giftBalance(g);
  const points = g.unit === 'points';

  async function step(n: number) {
    await addGiftLog(g!, { date: todayKey(), amount: -n * g!.denom!, kind: n > 0 ? 'use' : 'add', note: `${Math.abs(n)} 張` });
  }
  async function submit() {
    const v = numOrUndef(amount);
    if (v === undefined || !action) return;
    if (action === 'set') {
      const diff = round2(v - bal);
      if (diff) await addGiftLog(g!, { date: todayKey(), amount: diff, kind: 'set' });
    } else {
      if (v <= 0) return;
      await addGiftLog(g!, { date: todayKey(), amount: action === 'use' ? -v : v, kind: action, note: note.trim() || undefined });
    }
    onSaved('已更新');
    setAction(null);
    setAmount('');
    setNote('');
  }

  const labels = points
    ? { use: '兌換用掉的點數', add: '新增的點數', set: '現在 App 裡顯示的點數' }
    : { use: '使用金額', add: '加值金額', set: '實際剩下的金額' };

  return (
    <Sheet
      title={`${g.emoji} ${g.name}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={() => (onEdit(g), onClose())}>
            編輯
          </button>
          <button className="btn primary" onClick={onClose}>
            關閉
          </button>
        </>
      }
    >
      {isCountable(g) ? (
        <div className="stepper">
          <button className="step-btn" onClick={() => void step(1)} disabled={giftCount(g) <= 0} aria-label="用掉 1 張">
            −
          </button>
          <div>
            <b className="hero-num">{giftCount(g)}</b> 張<div className="muted small">{fmtTWD(bal)}</div>
          </div>
          <button className="step-btn" onClick={() => void step(-1)} aria-label="加回 1 張">
            ＋
          </button>
        </div>
      ) : (
        <div className="big-total small">
          <span>剩餘</span>
          <b>{giftFmt(g, bal)}</b>
          {!points && <small className="muted">已用 {fmtTWD(Math.max(0, giftTotal(g) - bal))} / 共 {fmtTWD(giftTotal(g))}</small>}
        </div>
      )}
      <div className="segmented">
        {(['use', 'add', 'set'] as const).map((a) => (
          <button
            key={a}
            className={action === a ? 'active' : ''}
            onClick={() => {
              setAction(action === a ? null : a);
              setAmount(a === 'set' ? String(bal) : '');
            }}
          >
            {{ use: '使用', add: '加值', set: '改餘額' }[a]}
          </button>
        ))}
      </div>
      {action && (
        <div className="inline-form">
          <label className="field">
            <span>{labels[action]}</span>
            <input type="number" inputMode="decimal" className="amount-input" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </label>
          {action !== 'set' && (
            <label className="field">
              <span>備註（選填）</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：買咖啡" />
            </label>
          )}
          <button className="btn primary block" onClick={submit}>
            確認
          </button>
        </div>
      )}
      <div className="section-label">紀錄</div>
      <div className="money-list">
        {[...g.log].reverse().map((l) => (
          <div key={l.id} className="money-row static">
            <span className="money-main">
              <span className="money-title">
                {KIND_LABEL[l.kind]}
                {l.note ? ` · ${l.note}` : ''}
              </span>
              <span className="money-sub">{fmtDateLabel(l.date)}</span>
            </span>
            <span className={`money-amt ${l.amount < 0 ? '' : 'plus'}`}>
              {l.amount < 0 ? '−' : '+'}
              {fmtNum(Math.abs(l.amount))}
            </span>
            {l.kind !== 'init' && (
              <button
                className="text-btn"
                aria-label="刪除這筆紀錄"
                onClick={() => confirm('刪除這筆紀錄？餘額會還原。') && void db.giftCards.put({ ...g, log: g.log.filter((x) => x.id !== l.id) })}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
