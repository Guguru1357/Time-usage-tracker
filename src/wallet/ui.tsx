import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronLeft, IconChevronRight } from '../components/Icons';
import { monthLabel, shiftMonth } from './money';

/** 底部面板 */
export function Sheet(props: { title: ReactNode; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  return createPortal(
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="sheet-body">
          <div className="sheet-title">{props.title}</div>
          {props.children}
        </div>
        <div className="sheet-actions">{props.actions}</div>
      </div>
    </div>,
    document.body,
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="month-nav">
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, -1))} aria-label="上個月">
        <IconChevronLeft />
      </button>
      <span>{monthLabel(month)}</span>
      <button className="icon-btn" onClick={() => onChange(shiftMonth(month, 1))} aria-label="下個月">
        <IconChevronRight />
      </button>
    </div>
  );
}

export interface Bar {
  label: string;
  /** 軸上的短標籤；空字串不顯示 */
  short: string;
  value: number;
}

/** 單一顏色的直條圖；點長條在上方顯示數值 */
export function BarChart({ bars, format, empty = '沒有資料' }: { bars: Bar[]; format: (v: number) => string; empty?: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(0, ...bars.map((b) => b.value));
  const W = 320;
  const H = 120;
  const B = 16;
  const step = W / Math.max(1, bars.length);
  const bw = Math.max(3, step - 3);
  const peak = bars.reduce((a, b, i) => (b.value > (bars[a]?.value ?? 0) ? i : a), 0);
  const shown = sel ?? (max > 0 ? peak : null);

  return (
    <div className="bar-chart">
      <div className="bar-readout">
        {max === 0 ? empty : shown !== null && (
          <>
            {sel === null && <span className="muted">最高 </span>}
            <b>{bars[shown].label}</b> {format(bars[shown].value)}
          </>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H + B}`} role="img">
        {bars.map((b, i) => {
          const h = max > 0 ? (b.value / max) * (H - 4) : 0;
          const x = i * step + (step - bw) / 2;
          return (
            <g key={i} onClick={() => setSel(sel === i ? null : i)}>
              <rect x={i * step} y={0} width={step} height={H + B} fill="transparent" />
              {h > 0 && (
                <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(3, bw / 2)} className={`bar${shown === i ? ' on' : ''}`} />
              )}
              {b.short && (
                <text
                  x={x + bw / 2 > W - 16 ? W : x + bw / 2 < 16 ? 0 : x + bw / 2}
                  y={H + 12}
                  textAnchor={x + bw / 2 > W - 16 ? 'end' : x + bw / 2 < 16 ? 'start' : 'middle'}
                  className="axis"
                >
                  {b.short}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H} y2={H} className="baseline" />
      </svg>
    </div>
  );
}

/** 橫條清單：名稱、比例條、數值 */
export function HBarList({ rows, format }: { rows: { key: string; label: ReactNode; value: number; color?: string; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">沒有資料</p>;
  return (
    <div className="hbar-list">
      {rows.map((r) => (
        <div key={r.key} className="hbar-row">
          <div className="hbar-top">
            <span>{r.label}</span>
            <span className="hbar-value">
              {format(r.value)}
              {r.sub && <small className="muted"> {r.sub}</small>}
            </span>
          </div>
          <div className="hbar-track">
            <div style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 數字輸入：空白時回傳 undefined */
export function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function useToast(): [string, (msg: string) => void, ReactNode] {
  const [msg, setMsg] = useState('');
  const say = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? '' : cur)), 2500);
  };
  const node = msg ? (
    <div className="toast" onClick={() => setMsg('')}>
      {msg}
    </div>
  ) : null;
  return [msg, say, node];
}
