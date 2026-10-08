import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import type { DetailType, StudyDetails } from '../db';
import { STUDY_FIELDS, recentTitles, splitTags } from '../study';

interface Props {
  type: DetailType;
  value: StudyDetails;
  onChange: (v: StudyDetails) => void;
}

/** 學習細節欄位，全部選填 */
export function StudyFields({ type, value, onChange }: Props) {
  const spec = STUDY_FIELDS[type];
  const titles = useLiveQuery(() => recentTitles(type), [type]) ?? [];
  const q = value.title?.trim() ?? '';
  const suggestions = titles.filter((t) => t !== q && (!q || t.includes(q))).slice(0, 6);

  return (
    <div className="study">
      <label className="field compact">
        <span>{spec.titleLabel}</span>
        <input value={value.title ?? ''} placeholder={spec.titlePlaceholder} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </label>
      {suggestions.length > 0 && (
        <div className="chips suggest">
          {suggestions.map((t) => (
            <button key={t} className="chip" onClick={() => onChange({ ...value, title: t })}>
              {t}
            </button>
          ))}
        </div>
      )}
      {spec.progressLabel && (
        <label className="field compact">
          <span>{spec.progressLabel}</span>
          <input value={value.progress ?? ''} placeholder={spec.progressPlaceholder} onChange={(e) => onChange({ ...value, progress: e.target.value })} />
        </label>
      )}
      {spec.language && (
        <>
          <TagInput label="文法" placeholder="輸入後按加入" values={value.grammar ?? []} onChange={(grammar) => onChange({ ...value, grammar })} />
          <TagInput label="單字" placeholder="可一次輸入多個，用逗號分開" values={value.vocab ?? []} onChange={(vocab) => onChange({ ...value, vocab })} />
        </>
      )}
    </div>
  );
}

function TagInput(props: { label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const commit = () => {
    const add = splitTags(text).filter((t) => !props.values.includes(t));
    if (add.length) props.onChange([...props.values, ...add]);
    setText('');
  };
  return (
    <div className="field compact">
      <span>
        {props.label}
        {props.values.length > 0 && <em> · {props.values.length}</em>}
      </span>
      {props.values.length > 0 && (
        <div className="tags">
          {props.values.map((v) => (
            <button key={v} className="tag" onClick={() => props.onChange(props.values.filter((x) => x !== v))} aria-label={`移除 ${v}`}>
              {v}
              <span>×</span>
            </button>
          ))}
        </div>
      )}
      <div className="tag-input">
        <input
          value={text}
          placeholder={props.placeholder}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
        />
        <button className="chip" onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={!text.trim()}>
          加入
        </button>
      </div>
    </div>
  );
}
