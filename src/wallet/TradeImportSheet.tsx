import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { db } from '../db';
import { useSettings } from '../hooks';
import { fmtDateLabel, todayKey } from '../time';
import { accountKind, balancesAt, currencyOf, setBalance } from './assets';
import { DEFAULT_USD_RATE, fmtTWD } from './money';
import {
  CLAUDE_PROMPT,
  applyImport,
  mismatchReport,
  monthsOf,
  parseTradeImport,
  planImport,
  priorPositions,
  summarizeBySymbol,
  type ImportPlan,
  type ParsedImport,
  type ReplaceMode,
  type SymbolSummary,
} from './tradeImport';
import { Sheet, numOrUndef } from './ui';

function fmtShares(n: number): string {
  if (n === 0) return '0';
  return n % 1000 === 0 ? `${n / 1000} 張` : `${n.toLocaleString('zh-TW', { maximumFractionDigits: 4 })} 股`;
}

function monthText(m: string): string {
  return `${Number(m.slice(5))} 月`;
}

const STATUS_TEXT: Record<SymbolSummary['status'], string> = {
  ok: '✓ 對得上',
  older: '庫存較多（可能是更早買的）',
  soldEarlier: '賣出之前買的股票',
  mismatch: '⚠ 對不上',
  unknown: '',
};

/** 截圖 → Claude App 整理成檔案 → 匯入：說明、選檔、核對、確認 */
export function TradeImportSheet({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const settings = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [mode, setMode] = useState<ReplaceMode>('months');
  const existing = useLiveQuery(() => db.trades.toArray());
  // 檔案開始的月份之前已經持有的股數，跨月的買賣才核對得起來
  const prior = useMemo(() => (parsed && existing ? priorPositions(existing, parsed, mode) : new Map<string, number>()), [parsed, existing, mode]);
  const plan: ImportPlan | null = useMemo(
    () => (parsed ? planImport(parsed, settings.usdRate ?? DEFAULT_USD_RATE, Date.now(), prior) : null),
    [parsed, prior, settings.usdRate],
  );
  const [addOpening, setAddOpening] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [fallbackText, setFallbackText] = useState('');
  // Step 5：照券商 App 填入證券戶目前的實際餘額
  const brokers = (useLiveQuery(() => db.accounts.orderBy('order').toArray()) ?? []).filter(
    (a) => !a.archived && accountKind(a) === 'broker' && currencyOf(a) === 'TWD',
  );
  const balances = useLiveQuery(() => db.balances.toArray()) ?? [];
  const [brokerId, setBrokerId] = useState<string | undefined>();
  const chosenBroker = brokerId ?? brokers[0]?.id;
  const currentBal = chosenBroker ? balancesAt(balances).get(chosenBroker)?.amount : undefined;
  const [brokerBal, setBrokerBal] = useState('');

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setFallbackText('');
    } catch {
      // 有些手機不允許直接複製：改成顯示文字讓使用者長按複製
      setFallbackText(text);
    }
  }

  async function onFile(f: File) {
    setError('');
    setCopied('');
    try {
      const p = parseTradeImport(await f.text());
      if (!p.rows.length && !p.holdings.length) throw new Error('檔案裡沒有交易或庫存');
      setParsed(p);
    } catch (e) {
      setParsed(null);
      setError((e as Error).message);
    }
  }

  const months = plan ? monthsOf(plan) : [];
  const summary = parsed ? summarizeBySymbol(parsed, prior) : [];
  const report = mismatchReport(summary);
  const bad = summary.filter((x) => x.status === 'mismatch').length;
  const openingCount = plan?.opening.length ?? 0;

  async function confirmImport() {
    if (!plan) return;
    const what = mode === 'all' ? 'App 裡所有的股票交易' : mode === 'months' ? `${months.map(monthText).join('、')}的所有股票交易` : '';
    if (bad && !confirm(`有 ${bad} 檔交易和庫存對不上，確定還是要匯入嗎？`)) return;
    if (what && !confirm(`會刪除${what}，換成這個檔案的紀錄。確定嗎？`)) return;
    const r = await applyImport(plan, { mode, addOpening });
    const bal = numOrUndef(brokerBal);
    if (chosenBroker && bal !== undefined) await setBalance(chosenBroker, bal, todayKey());
    const broker = brokers.find((a) => a.id === chosenBroker);
    onDone(
      `已匯入 ${r.added} 筆${r.skipped ? `（${r.skipped} 筆重複略過）` : ''}${r.removed ? `，取代舊紀錄 ${r.removed} 筆` : ''}` +
        (broker && bal !== undefined ? `；${broker.name}餘額更新為 ${fmtTWD(bal)}` : ''),
    );
    onClose();
  }

  return (
    <Sheet
      title="從截圖匯入交易"
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!plan || (!plan.trades.length && !(addOpening && openingCount))} onClick={confirmImport}>
            匯入
          </button>
        </>
      }
    >
      <ol className="import-steps">
        <li>
          在券商 App 截圖這個月的「<b>交易明細</b>」和目前的「<b>庫存</b>」。
        </li>
        <li>
          複製說明，打開 <b>Claude App</b>，貼上說明並附上截圖送出。
          <button className="btn block" onClick={() => copy(CLAUDE_PROMPT, 'prompt')}>
            {copied === 'prompt' ? '✓ 已複製，去 Claude App 貼上' : '複製給 Claude 的說明'}
          </button>
        </li>
        <li>把 Claude 做好的 JSON 檔下載到手機。</li>
        <li>
          選擇那個檔案：
          <button className="btn block" onClick={() => file.current?.click()}>
            選擇檔案…
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </li>
      </ol>
      {fallbackText && <textarea className="prompt-box" readOnly value={fallbackText} onFocus={(e) => e.target.select()} />}
      {error && <div className="error">{error}</div>}

      {plan && parsed && (
        <div className="import-preview">
          <div className="section-label">檔案內容</div>
          <p>
            交易 <b>{plan.trades.length}</b> 筆
            {plan.from && plan.to && `（${fmtDateLabel(plan.from)} ～ ${fmtDateLabel(plan.to)}）`}
            {parsed.holdingsProvided ? (parsed.holdings.length ? `，庫存 ${parsed.holdings.length} 檔` : '，庫存：目前沒有持股') : '，沒有庫存資料'}
          </p>
          {parsed.errors.length > 0 && (
            <div className="warn">
              有 {parsed.errors.length} 筆看不懂，會略過：
              <ul>
                {parsed.errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="section-label">每檔核對（月初持有 ＋ 買 − 賣，和庫存比）</div>
          <div className="money-list">
            {summary.map((x) => (
              <div key={`${x.market}${x.symbol}`} className={`money-row static check-row st-${x.status}`}>
                <span className="money-main">
                  <span className="money-title">
                    {x.symbol} {x.name}
                    {x.dayTradeDates.length > 0 && <span className="tag">當沖 {x.dayTradeDates.map((d) => fmtDateLabel(d).split('（')[0]).join('、')}・已平倉</span>}
                  </span>
                  <span className="money-sub">
                    {x.prior > 0 && `月初持有 ${fmtShares(x.prior)} · `}
                    買 {fmtShares(x.bought)} · 賣 {fmtShares(x.sold)}
                    {x.holding !== undefined && ` · 庫存 ${fmtShares(x.holding)}`}
                  </span>
                </span>
                {x.status !== 'unknown' && <span className="check-status">{STATUS_TEXT[x.status]}</span>}
              </div>
            ))}
          </div>
          {summary.some((x) => x.status === 'soldEarlier') && (
            <p className="muted small">「賣出之前買的股票」：App 裡沒有那些股票當初的買進紀錄，這幾筆的損益會不準。可以再匯入之前月份的明細補上。</p>
          )}
          {report && (
            <>
              <p className="muted small">對不上的通常是 Claude 讀錯或漏了截圖。可以把清單貼回 Claude App，請它對照截圖修正後重做一次檔案。</p>
              <button className="btn block" onClick={() => copy(report, 'report')}>
                {copied === 'report' ? '✓ 已複製，貼回 Claude App' : '複製不一致清單給 Claude'}
              </button>
            </>
          )}
          {openingCount > 0 && (
            <label className="toggle-row">
              <input type="checkbox" checked={addOpening} onChange={(e) => setAddOpening(e.target.checked)} />
              <span>
                用庫存補上期初持股（{openingCount} 檔）
                <small className="muted">只有確定庫存截圖正確、而且是更早之前買的股票才勾</small>
              </span>
            </label>
          )}

          <div className="section-label">要取代哪些舊紀錄</div>
          <div className="mode-list">
            {(
              [
                ['months', `取代 ${months.map(monthText).join('、') || '這個月'}的所有交易`, '這幾個月裡原本的交易全部刪掉，換成檔案的；其他月份不動'],
                ['all', '取代全部交易', '刪掉 App 裡所有股票交易，只留檔案的'],
                ['append', '不取代，只新增', '加在現有紀錄後面，完全相同的交易會略過'],
              ] as [ReplaceMode, string, string][]
            ).map(([m, title, hint]) => (
              <label key={m} className={`mode-option${mode === m ? ' selected' : ''}`}>
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                <span>
                  {title}
                  <small className="muted">{hint}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="section-label">5. 證券戶目前餘額</div>
          {brokers.length === 0 ? (
            <p className="muted small">還沒有證券帳戶。到「資產 → 證券」新增交割戶後，就可以在這裡一起更新餘額。</p>
          ) : (
            <>
              {brokers.length > 1 && (
                <div className="chips">
                  {brokers.map((a) => (
                    <button key={a.id} className={`chip${chosenBroker === a.id ? ' selected' : ''}`} onClick={() => setBrokerId(a.id)}>
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
              <label className="field">
                <span>
                  {brokers.find((a) => a.id === chosenBroker)?.name} 實際餘額（看券商 App 填）
                  {currentBal !== undefined && `，目前記錄 ${fmtTWD(currentBal)}`}
                </span>
                <input type="number" inputMode="decimal" className="amount-input" value={brokerBal} onChange={(e) => setBrokerBal(e.target.value)} placeholder="不填就不更改" />
              </label>
            </>
          )}
          <p className="muted small">匯入和刪除交易都不會自動加減證券戶餘額，餘額以你在這裡填的實際數字為準。</p>
        </div>
      )}
    </Sheet>
  );
}
