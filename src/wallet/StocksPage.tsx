import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { IconPlus } from '../components/Icons';
import { db, uid, type Emotion, type Trade } from '../db';
import { rescheduleReminders } from '../notifications';
import { addDays, fmtDateLabel, fmtHM, todayKey } from '../time';
import { fmtNum, fmtTWD, round2 } from './money';
import { EMOTIONS, EMOTION_ORDER, analyzePositions, markTradeDay, reportedTradeDays, sortTrades, tradeAmount, tradeReport, dailyCounts, weeklyCounts } from './stocks';
import { BarChart, HBarList, Sheet, numOrUndef, useToast } from './ui';

const PERIOD_DAYS = 30;

function pnlText(v: number): string {
  if (Math.abs(v) < 0.5) return 'NT$0';
  return `${v > 0 ? '+' : '−'}${fmtTWD(Math.abs(v))}`;
}

export function StocksPage({ focus }: { focus?: { date: string; action?: 'noTrade' | 'closed'; nonce: number } }) {
  const trades = useLiveQuery(() => db.trades.toArray()) ?? [];
  const reported = useLiveQuery(() => reportedTradeDays()) ?? new Set<string>();
  const [editing, setEditing] = useState<Partial<Trade> | null>(null);
  const [countMode, setCountMode] = useState<'day' | 'week'>('day');
  const [, say, toast] = useToast();
  const today = todayKey();

  async function mark(date: string, kind: 'noTrade' | 'closed') {
    await markTradeDay(date, kind);
    void rescheduleReminders();
    say(kind === 'closed' ? '已標記休市' : '已記錄：今天沒交易');
  }

  // 從通知進來：按鈕直接記錄；點通知本身打開新增畫面
  useEffect(() => {
    if (!focus) return;
    if (focus.action) void mark(focus.date, focus.action);
    else setEditing({ date: focus.date });
  }, [focus?.nonce]);

  const from = addDays(today, -(PERIOD_DAYS - 1));
  const report = tradeReport(trades, from, today);
  const { holdings, realized } = analyzePositions(trades);
  // 12 週的日期標籤太擠，隔週顯示一次（最後一週一定顯示）
  // 近 30 天每日筆數；日期標籤每 5 天顯示一次，最後一天一定顯示
  const daily = dailyCounts(trades, today, PERIOD_DAYS).map((d, i) => ({
    label: fmtDateLabel(d.date),
    short: (PERIOD_DAYS - 1 - i) % 5 === 0 ? `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}` : '',
    value: d.count,
  }));
  const weekly = weeklyCounts(trades, today, 12).map((w, i) => ({
    label: `${fmtDateLabel(w.start)} 那週`,
    short: (11 - i) % 2 === 0 ? `${Number(w.start.slice(5, 7))}/${Number(w.start.slice(8))}` : '',
    value: w.count,
  }));
  const weekday = ![0, 6].includes(new Date().getDay());
  const todayTrades = trades.filter((t) => t.date === today);
  const recent = sortTrades(trades).reverse().slice(0, 30);
  const byDate = new Map<string, Trade[]>();
  for (const t of recent) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }

  return (
    <>
      {weekday && (
        <div className={`report-card${reported.has(today) ? ' done' : ''}`}>
          <b>今天的進出</b>
          {todayTrades.length ? (
            <span>已記錄 {todayTrades.length} 筆</span>
          ) : reported.has(today) ? (
            <span>已回報：今天沒有交易</span>
          ) : (
            <div className="btn-row">
              <button className="btn sm" onClick={() => setEditing({ date: today })}>
                記一筆
              </button>
              <button className="btn sm" onClick={() => void mark(today, 'noTrade')}>
                今天沒交易
              </button>
              <button className="btn sm" onClick={() => void mark(today, 'closed')}>
                休市
              </button>
            </div>
          )}
        </div>
      )}

      <h3>近 30 天的交易習慣</h3>
      <div className="stock-stats">
        <div>
          <span>交易</span>
          <b>{report.count} 筆</b>
          <small>{report.tradingDays} 天</small>
        </div>
        <div>
          <span>定期定額</span>
          <b>{report.dca} 筆</b>
          <small>自動扣款</small>
        </div>
        <div>
          <span>帶情緒</span>
          <b>{report.manual ? Math.round((report.emotional / report.manual) * 100) : 0}%</b>
          <small>自己下單 {report.manual} 筆</small>
        </div>
      </div>

      <div className="section-head">
        <h3>{countMode === 'day' ? '每日交易筆數（近 30 天）' : '每週交易筆數（近 12 週）'}</h3>
        <div className="segmented mini">
          <button className={countMode === 'day' ? 'active' : ''} onClick={() => setCountMode('day')}>
            每日
          </button>
          <button className={countMode === 'week' ? 'active' : ''} onClick={() => setCountMode('week')}>
            每週
          </button>
        </div>
      </div>
      <div className="card chart-card">
        <BarChart key={countMode} bars={countMode === 'day' ? daily : weekly} format={(v) => `${v} 筆`} empty="還沒有交易紀錄" />
      </div>

      {report.manual > 0 && (
        <>
          <h3>自己下單時的心情（筆數 · 已實現損益）</h3>
          <HBarList
            rows={EMOTION_ORDER.filter((e) => report.emotions.get(e)).map((e) => {
              const x = report.emotions.get(e)!;
              return { key: e, label: EMOTIONS[e].label, value: x.count, sub: x.sells ? pnlText(x.pnl) : '', color: e === 'calm' ? '#8fa894' : '#b9a58f' };
            })}
            format={(v) => `${v} 筆`}
          />
        </>
      )}

      {holdings.length > 0 && (
        <>
          <h3>目前持股（平均成本）</h3>
          <div className="money-list">
            {holdings.map((h) => (
              <div key={h.symbol} className="money-row static">
                <span className="money-main">
                  <span className="money-title">
                    {h.symbol} {h.name}
                  </span>
                  <span className="money-sub">
                    {h.shares % 1000 === 0 ? `${h.shares / 1000} 張` : `${fmtNum(h.shares)} 股`} · 均價 {h.avgCost}
                  </span>
                </span>
                <span className="money-amt">{fmtTWD(h.avgCost * h.shares)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>最近的交易</h3>
      {byDate.size === 0 ? (
        <p className="muted">還沒有交易紀錄</p>
      ) : (
        [...byDate.entries()].map(([date, list]) => (
          <div key={date}>
            <div className="day-group">
              <span>{fmtDateLabel(date)}</span>
              <span>{list.length} 筆</span>
            </div>
            <div className="money-list">
              {list.map((t) => {
                const r = realized.get(t.id);
                return (
                  <button key={t.id} className="money-row" onClick={() => setEditing(t)}>
                    <span className={`side-tag ${t.side}`}>{t.side === 'buy' ? '買' : '賣'}</span>
                    <span className="money-main">
                      <span className="money-title">
                        {t.symbol} {t.name}
                      </span>
                      <span className="money-sub">
                        {t.price} × {t.shares % 1000 === 0 ? `${t.shares / 1000} 張` : `${fmtNum(t.shares)} 股`} · {t.dca ? '定期定額' : EMOTIONS[t.emotion].label}
                      </span>
                    </span>
                    <span className="money-amt">
                      {fmtTWD(tradeAmount(t))}
                      {r !== undefined && <small className={r >= 0 ? 'gain' : 'loss'}>{pnlText(r)}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      <button className="fab" onClick={() => setEditing({ date: today })} aria-label="記一筆交易">
        <IconPlus size={26} />
      </button>
      {editing && <TradeSheet initial={editing} trades={trades} onClose={() => setEditing(null)} onSaved={say} />}
      {toast}
    </>
  );
}

function TradeSheet({ initial, trades, onClose, onSaved }: { initial: Partial<Trade>; trades: Trade[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [side, setSide] = useState<Trade['side']>(initial.side ?? 'buy');
  const [symbol, setSymbol] = useState(initial.symbol ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [price, setPrice] = useState(initial.price ? String(initial.price) : '');
  const [unit, setUnit] = useState<'lot' | 'share'>(initial.shares && initial.shares % 1000 !== 0 ? 'share' : 'lot');
  const [qty, setQty] = useState(initial.shares ? String(initial.shares % 1000 === 0 ? initial.shares / 1000 : initial.shares) : '');
  const [fee, setFee] = useState(initial.fee ? String(initial.fee) : '');
  const [emotion, setEmotion] = useState<Emotion | undefined>(initial.emotion);
  const [dca, setDca] = useState(initial.dca ?? false);
  /** 定期定額的扣款金額：輸入金額與成交價時自動算股數 */
  const [dcaAmount, setDcaAmount] = useState('');
  const [reason, setReason] = useState(initial.reason ?? '');
  const [date, setDate] = useState(initial.date ?? todayKey());
  const [time, setTime] = useState(initial.time ?? (initial.id ? '' : fmtHM(Date.now())));
  const [error, setError] = useState('');

  // 交易過的股票，最近的在前
  const known = new Map<string, string | undefined>();
  for (const t of sortTrades(trades).reverse()) if (!known.has(t.symbol)) known.set(t.symbol, t.name);
  const shares = (numOrUndef(qty) ?? 0) * (unit === 'lot' && !dca ? 1000 : 1);
  const p = numOrUndef(price) ?? 0;

  function autoShares(amountText: string, priceText: string) {
    const a = numOrUndef(amountText);
    const pr = numOrUndef(priceText);
    if (a && pr) setQty(String(Math.floor(a / pr)));
  }

  async function save() {
    if (!symbol.trim()) return setError('請輸入股票代號或名稱');
    if (!(p > 0) || !(shares > 0)) return setError('請輸入價格和數量');
    if (!dca && !emotion) return setError('選一下當時的心情，之後才看得出自己的模式');
    await db.trades.put({
      id: initial.id ?? uid(),
      date,
      time: time || undefined,
      side: dca ? 'buy' : side,
      symbol: symbol.trim().toUpperCase(),
      name: name.trim() || undefined,
      price: p,
      shares,
      fee: numOrUndef(fee),
      emotion: dca ? 'calm' : emotion!,
      dca: dca || undefined,
      reason: reason.trim() || undefined,
      createdAt: initial.createdAt ?? Date.now(),
    });
    void rescheduleReminders();
    onSaved(`已記錄 ${dca ? '定期定額' : side === 'buy' ? '買進' : '賣出'} ${symbol.trim()}`);
    onClose();
  }

  async function remove() {
    if (!initial.id || !confirm('刪除這筆交易？')) return;
    await db.trades.delete(initial.id);
    onClose();
  }

  return (
    <Sheet
      title={initial.id ? '編輯交易' : '記一筆交易'}
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
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={dca}
          onChange={(e) => {
            setDca(e.target.checked);
            if (e.target.checked) setUnit('share');
          }}
        />
        <span>
          定期定額
          <small className="muted">（自動扣款買進，不用選心情）</small>
        </span>
      </label>
      {!dca && (
        <div className="segmented">
          <button className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>
            買進
          </button>
          <button className={side === 'sell' ? 'active' : ''} onClick={() => setSide('sell')}>
            賣出
          </button>
        </div>
      )}
      <div className="two-col">
        <label className="field">
          <span>代號</span>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="例如 2330" />
        </label>
        <label className="field">
          <span>名稱（選填）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 台積電" />
        </label>
      </div>
      {known.size > 0 && (
        <div className="chips">
          {[...known.entries()].slice(0, 8).map(([s, n]) => (
            <button
              key={s}
              className={`chip${symbol === s ? ' selected' : ''}`}
              onClick={() => {
                setSymbol(s);
                setName(n ?? '');
              }}
            >
              {s} {n}
            </button>
          ))}
        </div>
      )}
      {dca && (
        <label className="field">
          <span>扣款金額（選填，填了會自動算股數）</span>
          <input
            type="number"
            inputMode="decimal"
            value={dcaAmount}
            onChange={(e) => {
              setDcaAmount(e.target.value);
              autoShares(e.target.value, price);
            }}
            placeholder="例如 3000"
          />
        </label>
      )}
      <div className="two-col">
        <label className="field">
          <span>成交價</span>
          <input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              if (dca) autoShares(dcaAmount, e.target.value);
            }}
          />
        </label>
        <div className="field">
          <span>{dca ? '股數' : '數量'}</span>
          <div className="qty-row">
            <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            {!dca && (
              <>
                <button className={`chip${unit === 'lot' ? ' selected' : ''}`} onClick={() => setUnit('lot')}>
                  張
                </button>
                <button className={`chip${unit === 'share' ? ' selected' : ''}`} onClick={() => setUnit('share')}>
                  股
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {p > 0 && shares > 0 && <div className="muted small">金額 {fmtTWD(round2(p * shares))}</div>}

      {!dca && (
        <>
          <div className="section-label">當時的心情</div>
          <div className="emotion-grid">
            {EMOTION_ORDER.map((e) => (
              <button key={e} className={`emotion-btn${emotion === e ? ' selected' : ''}`} onClick={() => setEmotion(e)}>
                <b>{EMOTIONS[e].label}</b>
                <small>{EMOTIONS[e].hint}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <label className="field">
        <span>{dca ? '備註（選填）' : '理由（選填）'}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dca ? '例如：每月 6 號扣款' : '例如：跌到支撐、看到新聞'} />
      </label>
      <div className="two-col">
        <label className="field">
          <span>日期</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>時間（選填）</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>手續費＋稅（選填）</span>
        <input type="number" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="不填也可以" />
      </label>
      {error && <div className="error">{error}</div>}
    </Sheet>
  );
}
