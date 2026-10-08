import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CURRENT_BUILD, installUpdate, type UpdateInfo } from '../updater';

export function UpdateSheet({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'downloading' | 'started' | 'permission' | 'error'>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');

  async function start() {
    setState('downloading');
    setPercent(0);
    try {
      const r = await installUpdate(info, setPercent);
      setState(r === 'need-permission' ? 'permission' : 'started');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={state === 'downloading' ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <div className="sheet-title">有新版本</div>
          <div className="muted small">
            {CURRENT_BUILD ? `#${CURRENT_BUILD}` : '開發版'} → #{info.build}　·　{info.publishedAt.slice(0, 10)}
          </div>
          {info.notes && <div className="release-notes">{info.notes}</div>}
          {state === 'downloading' && (
            <div className="progress">
              <div style={{ width: `${percent}%` }} />
              <span>下載中 {percent}%</span>
            </div>
          )}
          {state === 'permission' && (
            <p className="warn">請在剛打開的設定頁允許「時間記帳」安裝應用程式，回來後再按一次「立即更新」。</p>
          )}
          {state === 'started' && <p className="muted small">已開啟安裝畫面，按「更新」即可完成；資料會保留。</p>}
          {state === 'error' && <p className="error">{error}</p>}
        </div>
        <div className="sheet-actions">
          <button className="btn ghost" disabled={state === 'downloading'} onClick={onClose}>
            稍後
          </button>
          <button className="btn primary" disabled={state === 'downloading'} onClick={start}>
            {state === 'downloading' ? '下載中…' : state === 'started' ? '重新安裝' : '立即更新'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
