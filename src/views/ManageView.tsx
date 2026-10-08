import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Activity, Category, DetailType } from '../db';

// 欄位組合；日文與英文欄位相同，統計時依活動分開
const FIELD_OPTIONS: [DetailType | undefined, string][] = [
  [undefined, '無'],
  ['reading', '書名＋頁數'],
  ['japanese', '教材＋文法＋單字'],
  ['medical', '書名＋章節'],
];
const sameFields = (a: DetailType | undefined, b: DetailType | undefined) =>
  a === b || (a === 'english' && b === 'japanese') || (a === 'japanese' && b === 'english');
import { useCatalog } from '../hooks';
import { archiveActivity, deleteCategory, move, saveActivity, saveCategory } from '../repo';

const SWATCHES = [
  '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#16a34a', '#0d9488', '#0891b2',
  '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#db2777', '#64748b',
];

type Editing =
  | { kind: 'activity'; value: Partial<Activity> }
  | { kind: 'category'; value: Partial<Category> }
  | null;

export function ManageView() {
  const catalog = useCatalog();
  const [tab, setTab] = useState<'activities' | 'categories'>('activities');
  const [editing, setEditing] = useState<Editing>(null);

  if (!catalog) return <div className="loading">載入中…</div>;
  const { categories, activities, categoryById } = catalog;

  const groups = categories
    .map((c) => ({ cat: c as Category | null, acts: activities.filter((a) => a.categoryId === c.id) }))
    .concat([{ cat: null, acts: activities.filter((a) => !categoryById.has(a.categoryId)) }])
    .filter((g) => g.cat || g.acts.length > 0);

  return (
    <div className="page">
      <header className="page-header">
        <h2>活動與分類</h2>
      </header>
      <div className="tabs">
        <button className={tab === 'activities' ? 'active' : ''} onClick={() => setTab('activities')}>
          活動
        </button>
        <button className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>
          分類
        </button>
      </div>

      {tab === 'activities' ? (
        <>
          {groups.map(({ cat, acts }) => (
            <section key={cat?.id ?? 'none'}>
              <h3 className={`group-title${cat?.highlight ? ' sns-text' : ''}`}>{cat?.name ?? '未分類'}</h3>
              {acts.length === 0 && <div className="muted small">（沒有活動）</div>}
              <div className="manage-list">
                {acts.map((a, i) => (
                  <div key={a.id} className="manage-row">
                    <button className="manage-main" onClick={() => setEditing({ kind: 'activity', value: a })}>
                      <span className="dot" style={{ background: a.color }} />
                      {a.name}
                    </button>
                    <button className="icon-btn sm" disabled={i === 0} onClick={() => move('activities', a.id, -1, (x) => (x as Activity).categoryId === a.categoryId)} aria-label="上移">
                      ↑
                    </button>
                    <button className="icon-btn sm" disabled={i === acts.length - 1} onClick={() => move('activities', a.id, 1, (x) => (x as Activity).categoryId === a.categoryId)} aria-label="下移">
                      ↓
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <button
            className="btn primary block"
            onClick={() => setEditing({ kind: 'activity', value: { color: SWATCHES[9], categoryId: categories[0]?.id ?? '' } })}
          >
            ＋ 新增活動
          </button>
        </>
      ) : (
        <>
          <div className="manage-list">
            {categories.map((c, i) => (
              <div key={c.id} className="manage-row">
                <button className="manage-main" onClick={() => setEditing({ kind: 'category', value: c })}>
                  <span className="dot" style={{ background: c.color }} />
                  {c.name}
                  {c.highlight && <span className="badge sns-badge">特別標示</span>}
                  <span className="muted small">　{activities.filter((a) => a.categoryId === c.id).length} 個活動</span>
                </button>
                <button className="icon-btn sm" disabled={i === 0} onClick={() => move('categories', c.id, -1)} aria-label="上移">
                  ↑
                </button>
                <button className="icon-btn sm" disabled={i === categories.length - 1} onClick={() => move('categories', c.id, 1)} aria-label="下移">
                  ↓
                </button>
              </div>
            ))}
          </div>
          <button className="btn primary block" onClick={() => setEditing({ kind: 'category', value: { color: SWATCHES[15], highlight: false } })}>
            ＋ 新增分類
          </button>
        </>
      )}

      {editing?.kind === 'activity' && (
        <ActivityForm initial={editing.value} categories={categories} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'category' && <CategoryForm initial={editing.value} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch${c === value ? ' selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
      <label className="swatch custom" style={{ background: SWATCHES.includes(value) ? undefined : value }}>
        ＋
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function ActivityForm({
  initial,
  categories,
  onClose,
  onSaved,
}: {
  initial: Partial<Activity>;
  categories: Category[];
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const [name, setName] = useState(initial.name ?? '');
  const [color, setColor] = useState(initial.color ?? SWATCHES[9]);
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? categories[0]?.id ?? '');
  const [longDuration, setLongDuration] = useState(initial.longDuration ?? false);
  const [detailType, setDetailType] = useState<DetailType | undefined>(initial.detailType);
  const [error, setError] = useState('');

  async function submit() {
    if (!name.trim()) return setError('請輸入名稱');
    const id = await saveActivity({ id: initial.id, name: name.trim(), color, categoryId, detailType, longDuration });
    onSaved?.(id);
    onClose();
  }
  async function remove() {
    if (!initial.id) return;
    if (!confirm(`刪除「${initial.name}」？過去的紀錄會保留。`)) return;
    await archiveActivity(initial.id);
    onClose();
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <div className="sheet-title">{initial.id ? '編輯活動' : '新增活動'}</div>
          <label className="field">
            <span>名稱</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!initial.id} />
          </label>
          <div className="field">
            <span>分類</span>
            <div className="chips">
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`chip${categoryId === c.id ? ' selected' : ''}`}
                  onClick={() => setCategoryId(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>顏色</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="field">
            <span>學習細節欄位</span>
            <div className="chips">
              {FIELD_OPTIONS.map(([t, label]) => (
                <button
                  key={t ?? 'none'}
                  className={`chip${sameFields(detailType, t) ? ' selected' : ''}`}
                  onClick={() => !sameFields(detailType, t) && setDetailType(t)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={longDuration} onChange={(e) => setLongDuration(e.target.checked)} />
            <span>
              長時間活動
              <small className="muted">（像睡覺一樣，記錄時長度快捷鍵改為 5～10 小時）</small>
            </span>
          </label>
          {error && <div className="error">{error}</div>}
        </div>
        <div className="sheet-actions">
          {initial.id ? (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          )}
          <button className="btn primary" onClick={submit}>
            儲存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CategoryForm({ initial, onClose }: { initial: Partial<Category>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [color, setColor] = useState(initial.color ?? SWATCHES[15]);
  const [highlight, setHighlight] = useState(initial.highlight ?? false);
  const [error, setError] = useState('');

  async function submit() {
    if (!name.trim()) return setError('請輸入名稱');
    await saveCategory({ id: initial.id, name: name.trim(), color, highlight });
    onClose();
  }
  async function remove() {
    if (!initial.id) return;
    if (!confirm(`刪除分類「${initial.name}」？`)) return;
    try {
      await deleteCategory(initial.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <div className="sheet-title">{initial.id ? '編輯分類' : '新增分類'}</div>
          <label className="field">
            <span>名稱</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!initial.id} />
          </label>
          <div className="field">
            <span>顏色</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
            <span>
              特別標示
              <small className="muted">（像 SNS 一樣在時間軸與統計中醒目顯示）</small>
            </span>
          </label>
          {error && <div className="error">{error}</div>}
        </div>
        <div className="sheet-actions">
          {initial.id ? (
            <button className="btn danger-ghost" onClick={remove}>
              刪除
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
          )}
          <button className="btn primary" onClick={submit}>
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}
