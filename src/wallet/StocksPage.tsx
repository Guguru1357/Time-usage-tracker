import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { IconPlus } from '../components/Icons';
import { db, uid, type Trade } from '../db';
import { rescheduleReminders } from '../notifications';
import { addDays, fmtDateLabel, fmtHM, todayKey } from '../time';
import { fmtNum, fmtTWD, round2 } from './money';
import { accountKind, currencyOf, fmtMoney } from './assets';
import { useSettings } from '../hooks';
import { DEFAULT_USD_RATE } from './money';
import { analyzePositions, dailyCounts, deleteTrade, markTradeDay, reportedTradeDays, saveTrade, sortTrades, tradeAmount, tradeCash, tradeFx, tradeReport, weeklyCounts } from './stocks';
import { BarChart, Sheet, numOrUndef, useToast } from './ui';

const PERIOD_DAYS = 30;

/** 美股可以有零股小數，最多顯示 4 位 */
function fmtNum4(n: number): string {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

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
          <span>已實現損益</span>
          <b className={report.realized > 0 ? 'gain' : report.realized < 0 ? 'loss' : ''}>{pnlText(report.realized)}</b>
          <small>近 30 天賣出</small>
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

      {holdings.length > 0 && (
        <>
          <h3>目前持股（平均成本）</h3>
          <div className="money-list">
            {holdings.map((h) => (
              <div key={`${h.market}${h.symbol}`} className="money-row static">
                <span className="money-main">
                  <span className="money-title">
                    {h.symbol} {h.name}
                    {h.market === 'US' && <span className="tag">美股</span>}
                  </span>
                  <span className="money-sub">
                    {h.market === 'US'
                      ? `${fmtNum4(h.shares)} 股 · 均價 US$${h.avgCost}`
                      : `${h.shares % 1000 === 0 ? `${h.shares / 1000} 張` : `${fmtNum(h.shares)} 股`} · 均價 ${h.avgCost}`}
                  </span>
                </span>
                <span className="money-amt">
                  {h.market === 'US' && <span>{fmtMoney(h.avgCost * h.shares, 'USD')}</span>}
                  {h.market === 'US' ? <small>成本 {fmtTWD(h.costTWD)}</small> : fmtTWD(h.costTWD)}
                </span>
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
                        {t.market === 'US' && <span className="tag">美股</span>}
                      </span>
                      <span className="money-sub">
                        {t.market === 'US'
                          ? `US$${t.price} × ${fmtNum4(t.shares)} 股 · 匯率 ${tradeFx(t)}`
                          : `${t.price} × ${t.shares % 1000 === 0 ? `${t.shares / 1000} 張` : `${fmtNum(t.shares)} 股`}`}
                        {t.dca ? ' · 定期定額' : ''}
                      </span>
                    </span>
                    <span className="money-amt">
                      {t.market === 'US' ? fmtMoney(tradeAmount(t), 'USD') : fmtTWD(tradeAmount(t))}
                      {t.market === 'US' && <small>≈ {fmtTWD(tradeAmount(t) * tradeFx(t))}</small>}
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
  const settings = useSettings();
  const [side, setSide] = useState<Trade['side']>(initial.side ?? 'buy');
  const [market, setMarket] = useState<'TW' | 'US'>(initial.market ?? 'TW');
  const [fx, setFx] = useState(initial.fx ? String(initial.fx) : '');
  const us = market === 'US';
  const fxValue = numOrUndef(fx) ?? settings.usdRate ?? DEFAULT_USD_RATE;
  const [symbol, setSymbol] = useState(initial.symbol ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [price, setPrice] = useState(initial.price ? String(initial.price) : '');
  const [unit, setUnit] = useState<'lot' | 'share'>(initial.shares && initial.shares % 1000 !== 0 ? 'share' : 'lot');
  const [qty, setQty] = useState(initial.shares ? String(initial.shares % 1000 === 0 ? initial.shares / 1000 : initial.shares) : '');
  const [fee, setFee] = useState(initial.fee ? String(initial.fee) : '');
  const [dca, setDca] = useState(initial.dca ?? false);
  /** 定期定額的扣款金額：輸入金額與成交價時自動算股數 */
  const [dcaAmount, setDcaAmount] = useState('');
  const [reason, setReason] = useState(initial.reason ?? '');
  const [date, setDate] = useState(initial.date ?? todayKey());
  const [time, setTime] = useState(initial.time ?? (initial.id ? '' : fmtHM(Date.now())));
  const [error, setError] = useState('');
  // 可以同步的台幣帳戶：證券交割戶排前面
  const accounts = (useLiveQuery(() => db.accounts.orderBy('order').toArray()) ?? [])
    .filter((a) => !a.archived && currencyOf(a) === 'TWD')
    .sort((a, b) => Number(accountKind(b) === 'broker') - Number(accountKind(a) === 'broker'));
  const firstBroker = accounts.find((a) => accountKind(a) === 'broker');
  // 新交易預設同步到第一個證券帳戶；舊交易沿用原本的設定
  const [accountId, setAccountId] = useState<string | undefined | null>(initial.id ? (initial.accountId ?? null) : undefined);
  const syncTo = accountId === undefined ? firstBroker?.id : (accountId ?? undefined);

  // 交易過的股票，最近的在前
  const known = new Map<string, { name?: string; market: 'TW' | 'US' }>();
  for (const t of sortTrades(trades).reverse()) if (!known.has(t.symbol)) known.set(t.symbol, { name: t.name, market: t.market ?? 'TW' });
  // 美股沒有「張」，數量一律是股（可有小數）
  const shares = (numOrUndef(qty) ?? 0) * (unit === 'lot' && !dca && !us ? 1000 : 1);
  const p = numOrUndef(price) ?? 0;

  function autoShares(amountText: string, priceText: string) {
    const a = numOrUndef(amountText);
    const pr = numOrUndef(priceText);
    // 美股可以買零股小數；台股取整數股
    if (a && pr) setQty(String(us ? Math.floor((a / pr) * 10000) / 10000 : Math.floor(a / pr)));
  }

  async function save() {
    if (!symbol.trim()) return setError('請輸入股票代號或名稱');
    if (!(p > 0) || !(shares > 0)) return setError('請輸入價格和數量');
    await saveTrade({
      id: initial.id ?? uid(),
      date,
      time: time || undefined,
      side: dca ? 'buy' : side,
      market: us ? 'US' : undefined,
      fx: us ? fxValue : undefined,
      symbol: symbol.trim().toUpperCase(),
      name: name.trim() || undefined,
      price: p,
      shares,
      fee: numOrUndef(fee),
      ...(initial.emotion ? { emotion: initial.emotion } : {}),
      dca: dca || undefined,
      reason: reason.trim() || undefined,
      accountId: syncTo,
      createdAt: initial.createdAt ?? Date.now(),
    });
    void rescheduleReminders();
    const synced = syncTo ? `，已同步到${accounts.find((a) => a.id === syncTo)?.name}` : '';
    onSaved(`已記錄 ${dca ? '定期定額' : side === 'buy' ? '買進' : '賣出'} ${symbol.trim()}${synced}`);
    onClose();
  }

  async function remove() {
    if (!initial.id || !confirm(`刪除這筆交易？${initial.accountId ? '\n帳戶餘額會一併還原。' : ''}`)) return;
    await deleteTrade(initial.id);
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
          <small className="muted">（自動扣款買進）</small>
        </span>
      </label>
      <div className="segmented">
        <button className={!us ? 'active' : ''} onClick={() => setMarket('TW')}>
          台股
        </button>
        <button className={us ? 'active' : ''} onClick={() => setMarket('US')}>
          美股
        </button>
      </div>
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
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={us ? '例如 AAPL' : '例如 2330'} />
        </label>
        <label className="field">
          <span>名稱（選填）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={us ? '例如 蘋果' : '例如 台積電'} />
        </label>
      </div>
      {known.size > 0 && (
        <div className="chips">
          {[...known.entries()].slice(0, 8).map(([s, k]) => (
            <button
              key={s}
              className={`chip${symbol === s ? ' selected' : ''}`}
              onClick={() => {
                setSymbol(s);
                setName(k.name ?? '');
                setMarket(k.market);
              }}
            >
              {s} {k.name}
            </button>
          ))}
        </div>
      )}
      {dca && (
        <label className="field">
          <span>扣款金額（{us ? '美元' : '台幣'}，選填，填了會自動算股數）</span>
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
          <span>成交價{us ? '（美元）' : ''}</span>
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
            {us && <span className="muted small">股</span>}
            {!dca && !us && (
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
      {us && (
        <label className="field">
          <span>匯率（1 美元 = 多少台幣）</span>
          <input type="number" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder={String(settings.usdRate ?? DEFAULT_USD_RATE)} />
          <small className="muted">不填就用資產頁設定的美元匯率；填券商實際成交的匯率最準</small>
        </label>
      )}
      {p > 0 && shares > 0 && (
        <div className="muted small">
          金額 {us ? `${fmtMoney(round2(p * shares), 'USD')} ≈ ${fmtTWD(p * shares * fxValue)}` : fmtTWD(round2(p * shares))}
        </div>
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
        <span>手續費＋稅{us ? '（美元）' : ''}（選填）</span>
        <input type="number" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="不填也可以" />
      </label>
      <div className="field">
        <span>同步到帳戶</span>
        {accounts.length === 0 ? (
          <small className="muted">到「資產」新增證券帳戶（交割戶）後，買賣會自動同步餘額</small>
        ) : (
          <>
            <div className="chips">
              {accounts.map((a) => (
                <button key={a.id} className={`chip${syncTo === a.id ? ' selected' : ''}`} onClick={() => setAccountId(a.id)}>
                  {a.name}
                </button>
              ))}
              <button className={`chip${!syncTo ? ' selected' : ''}`} onClick={() => setAccountId(null)}>
                不同步
              </button>
            </div>
            {syncTo && p > 0 && shares > 0 && (
              <small className="muted">
                {(() => {
                  const c = tradeCash({ side: dca ? 'buy' : side, price: p, shares, fee: numOrUndef(fee), market, fx: fxValue });
                  return `${accounts.find((a) => a.id === syncTo)?.name} ${c < 0 ? '扣款' : '入帳'} ${fmtTWD(Math.abs(c))}${us ? '（已換算台幣）' : ''}`;
                })()}
              </small>
            )}
          </>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </Sheet>
  );
}
