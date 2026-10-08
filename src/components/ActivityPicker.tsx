import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import type { Catalog } from '../hooks';
import { ActivityForm } from '../views/ManageView';

interface Props {
  catalog: Catalog;
  selectedId?: string;
  onSelect: (id: string) => void;
  /** 不顯示的活動（例如選副活動時排除主活動） */
  excludeIds?: string[];
}

/** 依分類排列的活動按鈕；可直接在分類旁新增活動 */
export function ActivityPicker({ catalog, selectedId, onSelect, excludeIds = [] }: Props) {
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const recent = useLiveQuery(async () => {
    const last = await db.entries.orderBy('start').reverse().limit(60).toArray();
    const ids: string[] = [];
    for (const e of last) if (!ids.includes(e.activityId)) ids.push(e.activityId);
    return ids;
  });
  const recentActs = (recent ?? [])
    .map((id) => catalog.activityById.get(id))
    .filter((a) => a && !a.archived && !excludeIds.includes(a.id))
    .slice(0, 6);

  const grouped = useMemo(
    () =>
      catalog.categories
        .map((c) => ({ cat: c, acts: catalog.activities.filter((a) => a.categoryId === c.id && !excludeIds.includes(a.id)) }))
        .concat([
          {
            cat: { id: '', name: '未分類', color: '#94a3b8', highlight: false, order: 999 },
            acts: catalog.activities.filter((a) => !catalog.categoryById.has(a.categoryId)),
          },
        ])
        .filter((g) => g.cat.id || g.acts.length > 0),
    [catalog, excludeIds],
  );

  return (
    <>
      {recentActs.length > 0 && (
        <>
          <div className="group-label">
            <span>最近使用</span>
          </div>
          <div className="act-grid">
            {recentActs.map((a) => (
              <ActButton key={a!.id} name={a!.name} color={a!.color} selected={selectedId === a!.id} onClick={() => onSelect(a!.id)} />
            ))}
          </div>
        </>
      )}
      {grouped.map(({ cat, acts }) => (
        <div key={cat.id || 'none'}>
          <div className="group-label">
            <span className={cat.highlight ? 'sns-text' : ''}>{cat.name}</span>
            {cat.id && (
              <button className="group-add" onClick={() => setAddingTo(cat.id)}>
                ＋ 新增
              </button>
            )}
          </div>
          <div className="act-grid">
            {acts.map((a) => (
              <ActButton key={a.id} name={a.name} color={a.color} selected={selectedId === a.id} onClick={() => onSelect(a.id)} />
            ))}
          </div>
        </div>
      ))}
      {addingTo !== null && (
        <ActivityForm
          initial={{ categoryId: addingTo, color: catalog.categoryById.get(addingTo)?.color }}
          categories={catalog.categories}
          onClose={() => setAddingTo(null)}
          onSaved={onSelect}
        />
      )}
    </>
  );
}

export function ActButton(props: { name: string; color: string; selected?: boolean; onClick: () => void }) {
  return (
    <button className={`act-btn${props.selected ? ' selected' : ''}`} style={{ ['--c' as string]: props.color }} onClick={props.onClick}>
      <span className="dot" />
      {props.name}
    </button>
  );
}

/** 疊在編輯畫面上的活動選擇面板 */
export function ActivityPickerSheet(props: { title: string; catalog: Catalog; excludeIds?: string[]; onSelect: (id: string) => void; onClose: () => void }) {
  return createPortal(
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <div className="sheet-title">{props.title}</div>
          <ActivityPicker
            catalog={props.catalog}
            excludeIds={props.excludeIds}
            onSelect={(id) => {
              props.onSelect(id);
              props.onClose();
            }}
          />
        </div>
        <div className="sheet-actions">
          <button className="btn ghost" onClick={props.onClose}>
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
