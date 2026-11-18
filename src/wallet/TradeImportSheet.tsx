import { useRef, useState } from 'react';
import { useSettings } from '../hooks';
import { fmtDateLabel } from '../time';
import { DEFAULT_USD_RATE } from './money';
import { CLAUDE_PROMPT, applyImport, parseTradeImport, planImport, type ImportPlan, type ParsedImport } from './tradeImport';
import { Sheet } from './ui';

function fmtShares(n: number): string {
  return n % 1000 === 0 && n >= 1000 ? `${n / 1000} 張` : `${n.toLocaleString('zh-TW', { maximumFractionDigits: 4 })} 股`;
}

/** 截圖 → Claude 整理成檔案 → 匯入：說明、選檔、預覽、確認 */
export function TradeImportSheet({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const settings = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [replace, setReplace] = useState(true);
  const [addOpening, setAddOpening] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CLAUDE_PROMPT);
      setCopied(true);
    } catch {
      // 有些手機不允許直接複製：改成顯示文字讓使用者長按複製
      setShowPrompt(true);
    }
  }

  async function onFile(f: File) {
    setError('');
    try {
      const p = parseTradeImport(await f.text());
      if (!p.rows.length && !p.holdings.length) throw new Error('檔案裡沒有交易或庫存');
      setParsed(p);
      setPlan(planImport(p, settings.usdRate ?? DEFAULT_USD_RATE));
    } catch (e) {
      setParsed(null);
      setPlan(null);
      setError((e as Error).message);
    }
  }

  async function confirmImport() {
    if (!plan) return;
    if (replace && !confirm('會刪除 App 裡現有的所有股票交易，改用這個檔案的紀錄。確定嗎？')) return;
    const r = await applyImport(plan, { replace, addOpening });
    onDone(`已匯入 ${r.added} 筆${r.skipped ? `（${r.skipped} 筆重複略過）` : ''}${r.removed ? `，刪除舊紀錄 ${r.removed} 筆` : ''}。記得到資產更新證券戶餘額`);
    onClose();
  }

  const openingCount = plan?.opening.length ?? 0;

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
          在券商 App 截圖「<b>交易明細</b>」和「<b>庫存</b>」。
        </li>
        <li>
          按下面的按鈕複製說明，打開 <b>Claude App</b>，貼上說明並附上截圖送出。
          <button className="btn block" onClick={copyPrompt}>
            {copied ? '✓ 已複製，去 Claude App 貼上' : '複製給 Claude 的說明'}
          </button>
          {showPrompt && <textarea className="prompt-box" readOnly value={CLAUDE_PROMPT} onFocus={(e) => e.target.select()} />}
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
      {error && <div className="error">{error}</div>}

      {plan && parsed && (
        <div className="import-preview">
          <div className="section-label">檔案內容</div>
          <p>
            交易 <b>{plan.trades.length}</b> 筆
            {plan.from && plan.to && `（${fmtDateLabel(plan.from)} ～ ${fmtDateLabel(plan.to)}）`}
            {parsed.holdings.length > 0 && `，庫存 ${parsed.holdings.length} 檔`}
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

          {parsed.holdings.length > 0 &&
            (plan.checks.length === 0 ? (
              <div className="ok-box">✓ 交易算出來的庫存和截圖一致</div>
            ) : (
              <>
                <div className="section-label">庫存核對</div>
                <div className="money-list">
                  {plan.checks.map((c) => (
                    <div key={`${c.market}${c.symbol}`} className="money-row static">
                      <span className="money-main">
                        <span className="money-title">
                          {c.symbol} {c.name}
                        </span>
                        <span className="money-sub">
                          截圖 {fmtShares(c.expected)} · 交易算出 {fmtShares(c.computed)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {openingCount > 0 ? (
                  <label className="toggle-row">
                    <input type="checkbox" checked={addOpening} onChange={(e) => setAddOpening(e.target.checked)} />
                    <span>
                      用庫存補上期初持股（{openingCount} 檔）
                      <small className="muted">截圖只涵蓋最近的交易時，補上更早買進的部分，持股和成本才會對</small>
                    </span>
                  </label>
                ) : (
                  <p className="muted small">不一致的部分可能是截圖漏了幾筆，可以補截圖再請 Claude 重做一次。</p>
                )}
              </>
            ))}

          <label className="toggle-row">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>
              取代 App 裡現有的所有交易
              <small className="muted">關掉的話會加在現有紀錄後面，完全相同的交易會略過</small>
            </span>
          </label>
          <p className="muted small">匯入的交易不會自動扣證券戶餘額（過去的交易早就反映在目前餘額裡）。匯入後請到「資產」照券商 App 更新一次證券戶餘額。</p>
        </div>
      )}
    </Sheet>
  );
}
