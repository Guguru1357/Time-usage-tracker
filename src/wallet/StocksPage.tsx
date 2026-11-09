import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { IconPlus } from '../components/Icons';
import { db, uid, type Emotion, type Trade } from '../db';
import { rescheduleReminders } from '../notifications';
import { addDays, fmtDateLabel, fmtHM, todayKey } from '../time';
import { fmtNum, fmtTWD, round2 } from './money';
import { EMOTIONS, EMOTION_ORDER, analyzePositions, markTradeDay, reportedTradeDays, sortTrades, tradeAmount, tradeReport, weeklyCounts } from './stocks';
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
          <span>計畫外</span>
          <b>{report.count ? Math.round((report.unplanned / report.count) * 100) : 0}%</b>
          <small>{report.unplanned} 筆</small>
        </div>
        <div>
          <span>帶情緒</span>
          <b>{report.count ? Math.round((report.emotional / report.count) * 100) : 0}%</b>
          <small>{report.emotional} 筆</small>
        </div>
      </div>

      {report.count > 0 &&
        (report.warnings.length ? (
          <div className="warn-list">
            {report.warnings.map((w) => (
              <div key={w.text} className={`warn-item ${w.level}`}>
                {w.level === 'high' ? '⚠ ' : '・'}
                {w.text}
              </div>
            ))}
          </div>
        ) : (
          <div className="ok-box">✓ 沒有明顯的過度交易或情緒交易跡象</div>
        ))}

      <h3>每週交易筆數</h3>
      <div className="card chart-card">
        <BarChart bars={weekly} format={(v) => `${v} 筆`} empty="還沒有交易紀錄" />
      </div>

      {report.count > 0 && (
        <>
          <h3>交易時的心情（筆數 · 已實現損益）</h3>
          <HBarList
            rows={EMOTION_ORDER.filter((e) => report.emotions.get(e)).map((e) => {
              const x = report.emotions.get(e)!;
              return { key: e, label: EMOTIONS[e].label, value: x.count, sub: x.sells ? pnlText(x.pnl) : '', color: e === 'calm' ? '#8fa894' : '#b9a58f' };
            })}
            format={(v) => `${v} 筆`}
          />
          <div className="meal-split">
            <div>
              <span>照計畫的賣出</span>
              <b>{pnlText(report.plannedPnl)}</b>
            </div>
            <div>
              <span>計畫外的賣出</span>
              <b>{pnlText(report.unplannedPnl)}</b>
            </div>
          </div>
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
                        {t.price} × {t.shares % 1000 === 0 ? `${t.shares / 1000} 張` : `${fmtNum(t.shares)} 股`} · {EMOTIONS[t.emotion].label}
                        {t.planned ? '' : ' · 計畫外'}
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
  const [planned, setPlanned] = useState<boolean | undefined>(initial.planned);
  const [reason, setReason] = useState(initial.reason ?? '');
  const [date, setDate] = useState(initial.date ?? todayKey());
  const [time, setTime] = useState(initial.time ?? (initial.id ? '' : fmtHM(Date.now())));
  const [error, setError] = useState('');

  // 交易過的股票，最近的在前
  const known = new Map<string, string | undefined>();
  for (const t of sortTrades(trades).reverse()) if (!known.has(t.symbol)) known.set(t.symbol, t.name);
  const shares = (numOrUndef(qty) ?? 0) * (unit === 'lot' ? 1000 : 1);
  const p = numOrUndef(price) ?? 0;

  async function save() {
    if (!symbol.trim()) return setError('請輸入股票代號或名稱');
    if (!(p > 0) || !(shares > 0)) return setError('請輸入價格和數量');
    if (!emotion) return setError('選一下當時的心情，之後才看得出自己的模式');
    if (planned === undefined) return setError('這筆是照計畫的嗎？');
    await db.trades.put({
      id: initial.id ?? uid(),
      date,
      time: time || undefined,
      side,
      symbol: symbol.trim().toUpperCase(),
      name: name.trim() || undefined,
      price: p,
      shares,
      fee: numOrUndef(fee),
      emotion,
      planned,
      reason: reason.trim() || undefined,
      createdAt: initial.createdAt ?? Date.now(),
    });
    void rescheduleReminders();
    onSaved(`已記錄 ${side === 'buy' ? '買進' : '賣出'} ${symbol.trim()}`);
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
      <div className="segmented">
        <button className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>
          買進
        </button>
        <button className={side === 'sell' ? 'active' : ''} onClick={() => setSide('sell')}>
          賣出
        </button>
      </div>
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
      <div className="two-col">
        <label className="field">
          <span>成交價</span>
          <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <div className="field">
          <span>數量</span>
          <div className="qty-row">
            <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            <button className={`chip${unit === 'lot' ? ' selected' : ''}`} onClick={() => setUnit('lot')}>
              張
            </button>
            <button className={`chip${unit === 'share' ? ' selected' : ''}`} onClick={() => setUnit('share')}>
              股
            </button>
          </div>
        </div>
      </div>
      {p > 0 && shares > 0 && <div className="muted small">金額 {fmtTWD(round2(p * shares))}</div>}

      <div className="section-label">當時的心情</div>
      <div className="emotion-grid">
        {EMOTION_ORDER.map((e) => (
          <button key={e} className={`emotion-btn${emotion === e ? ' selected' : ''}`} onClick={() => setEmotion(e)}>
            <b>{EMOTIONS[e].label}</b>
            <small>{EMOTIONS[e].hint}</small>
          </button>
        ))}
      </div>
      <div className="section-label">這筆是照事先的計畫嗎？</div>
      <div className="segmented">
        <button className={planned === true ? 'active' : ''} onClick={() => setPlanned(true)}>
          是，照計畫
        </button>
        <button className={planned === false ? 'active' : ''} onClick={() => setPlanned(false)}>
          不是，臨時決定
        </button>
      </div>
      <label className="field">
        <span>理由（選填）</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：跌到支撐、看到新聞" />
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
