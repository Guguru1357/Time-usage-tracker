import { useState } from 'react';
import { IconChevronLeft, IconChevronRight } from '../components/Icons';
import type { Activity } from '../db';
import { useCatalog, useEntries, type Catalog } from '../hooks';
import { computeStats, dailyHighlight, dayRange, hours, shiftWeek, weekRange, weekStartKey, type Amount, type StudyGroup } from '../stats';
import { STUDY_FIELDS } from '../study';
import { HOUR, addDays, fmtDateLabel, todayKey } from '../time';

type Mode = 'day' | 'week';
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const WEEK = 7 * 24 * HOUR;

export function StatsView() {
  const catalog = useCatalog();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(todayKey());

  const range = mode === 'day' ? dayRange(anchor) : weekRange(anchor);
  const prevRange = shiftWeek(range, -1);
  const entries = useEntries({ start: prevRange.start, end: range.end });

  if (!catalog || !entries) return <div className="loading">載入中…</div>;

  const now = Date.now();
  const isCurrent = now >= range.start && now < range.end;
  const until = isCurrent ? now : Infinity;
  const cur = computeStats(entries, range, catalog, until);
  const prev = computeStats(entries, prevRange, catalog, isCurrent ? now - WEEK : Infinity);
  const highlightCat = catalog.categories.find((c) => c.highlight);

  const step = (dir: -1 | 1) => setAnchor(addDays(anchor, dir * (mode === 'day' ? 1 : 7)));
  const ws = weekStartKey(anchor);
  const title =
    mode === 'day'
      ? fmtDateLabel(anchor)
      : `${fmtDateLabel(ws).replace(/（.）/, '')} – ${fmtDateLabel(addDays(ws, 6)).replace(/（.）/, '')}`;
  const atNow = mode === 'day' ? anchor === todayKey() : ws === weekStartKey(todayKey());

  return (
    <div className="page">
      <header className="page-header">
        <h2>統計</h2>
      </header>
      <div className="segmented">
        <button className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>
          日
        </button>
        <button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>
          週
        </button>
      </div>
      <div className="period-nav">
        <button className="icon-btn" onClick={() => step(-1)} aria-label="上一段">
          <IconChevronLeft />
        </button>
        <div className="period-title">
          {title}
          {atNow && <small>{mode === 'day' ? '今天' : '本週'}</small>}
        </div>
        <button className="icon-btn" onClick={() => step(1)} aria-label="下一段">
          <IconChevronRight />
        </button>
        {!atNow && (
          <button className="text-btn" onClick={() => setAnchor(todayKey())}>
            {mode === 'day' ? '今天' : '本週'}
          </button>
        )}
      </div>

      {highlightCat && (
        <SnsCard
          name={highlightCat.name}
          cur={cur.highlight}
          prev={prev.highlight}
          compareLabel={mode === 'day' ? (isCurrent ? '上週同日同時段' : '上週同日') : isCurrent ? '上週同期' : '上週'}
          daily={mode === 'week' ? dailyHighlight(entries, ws, catalog, until) : undefined}
          prevDaily={mode === 'week' ? dailyHighlight(entries, addDays(ws, -7), catalog) : undefined}
          todayIndex={isCurrent && mode === 'week' ? (new Date(now).getDay() + 6) % 7 : undefined}
        />
      )}

      <div className="summary">
        <div>
          <span>已記錄</span>
          <b>{hours(cur.recorded)}</b>
        </div>
        <div>
          <span>未記錄</span>
          <b>{hours(Math.max(0, cur.elapsed - cur.recorded))}</b>
        </div>
        <div>
          <span>記錄率</span>
          <b>{cur.elapsed ? Math.round((cur.recorded / cur.elapsed) * 100) : 0}%</b>
        </div>
      </div>

      {cur.byCategory.length === 0 ? (
        <div className="empty">這段期間還沒有紀錄</div>
      ) : (
        <>
          <h3>分類</h3>
          <CategoryBar amounts={cur.byCategory} catalog={catalog} />
          <AmountList
            amounts={cur.byCategory}
            total={cur.byCategory.reduce((s, a) => s + a.ms, 0)}
            label={(id) => catalog.categoryById.get(id)?.name ?? '未分類'}
            color={(id) => catalog.categoryById.get(id)?.color ?? '#a3a3a3'}
            highlight={(id) => !!catalog.categoryById.get(id)?.highlight}
          />

          <h3>活動</h3>
          <ActivityBars amounts={cur.byActivity} catalog={catalog} />

          {cur.secondaryByActivity.length > 0 && (
            <>
              <h3>同時進行</h3>
              <ActivityBars amounts={cur.secondaryByActivity} catalog={catalog} />
            </>
          )}

          {cur.study.length > 0 && (
            <>
              <h3>學習紀錄</h3>
              {cur.study.map((g) => (
                <StudyCard key={g.activityId} group={g} activity={catalog.activityById.get(g.activityId)} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SnsCard(props: {
  name: string;
  cur: number;
  prev: number;
  compareLabel: string;
  daily?: number[];
  prevDaily?: number[];
  todayIndex?: number;
}) {
  const diff = props.cur - props.prev;
  const pct = props.prev > 0 ? Math.round((diff / props.prev) * 100) : null;
  const trend =
    Math.abs(diff) < 60_000
      ? { cls: 'flat', text: `和${props.compareLabel}差不多` }
      : diff < 0
        ? { cls: 'down', text: `比${props.compareLabel}少 ${hours(-diff)}${pct !== null ? `（${pct}%）` : ''}` }
        : { cls: 'up', text: `比${props.compareLabel}多 ${hours(diff)}${pct !== null ? `（+${pct}%）` : ''}` };
  const max = Math.max(...(props.daily ?? [0]), ...(props.prevDaily ?? [0]), 30 * 60_000);

  return (
    <section className="sns-card">
      <div className="sns-label">{props.name}</div>
      <div className="sns-value">{hours(props.cur)}</div>
      <div className={`sns-trend ${trend.cls}`}>
        {trend.cls === 'down' ? '↓ ' : trend.cls === 'up' ? '↑ ' : ''}
        {trend.text}
      </div>
      {props.daily && props.prevDaily && (
        <>
          <div className="week-bars" role="img" aria-label={`每日${props.name}時間`}>
            {props.daily.map((ms, i) => {
              const future = props.todayIndex !== undefined && i > props.todayIndex;
              return (
                <div key={i} className="week-col" title={`週${WEEKDAYS[i]}：本週 ${hours(ms)}、上週 ${hours(props.prevDaily![i])}`}>
                  <span className="week-val">{!future && ms > 0 ? hours(ms) : ''}</span>
                  <div className="week-plot">
                    <div className="bar prev" style={{ height: `${(props.prevDaily![i] / max) * 100}%` }} />
                    {!future && <div className="bar cur" style={{ height: `${(ms / max) * 100}%` }} />}
                  </div>
                  <span className={`week-day${i === props.todayIndex ? ' today' : ''}`}>{WEEKDAYS[i]}</span>
                </div>
              );
            })}
          </div>
          <div className="legend">
            <span>
              <i className="sw cur" />
              本週
            </span>
            <span>
              <i className="sw prev" />
              上週
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function CategoryBar({ amounts, catalog }: { amounts: Amount[]; catalog: Catalog }) {
  const total = amounts.reduce((s, a) => s + a.ms, 0);
  return (
    <div className="stack-bar" role="img" aria-label="各分類時間比例">
      {amounts.map((a) => (
        <div key={a.id || 'none'} style={{ flexGrow: a.ms / total, background: catalog.categoryById.get(a.id)?.color ?? '#a3a3a3' }} />
      ))}
    </div>
  );
}

function AmountList(props: {
  amounts: Amount[];
  total: number;
  label: (id: string) => string;
  color: (id: string) => string;
  highlight: (id: string) => boolean;
}) {
  return (
    <div className="amount-list">
      {props.amounts.map((a) => (
        <div key={a.id || 'none'} className={`amount-row${props.highlight(a.id) ? ' sns-text' : ''}`}>
          <span className="dot" style={{ background: props.color(a.id) }} />
          <span className="amount-name">{props.label(a.id)}</span>
          <span className="amount-pct">{Math.round((a.ms / props.total) * 100)}%</span>
          <span className="amount-val">{hours(a.ms)}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityBars({ amounts, catalog }: { amounts: Amount[]; catalog: Catalog }) {
  const [all, setAll] = useState(false);
  const max = amounts[0]?.ms ?? 1;
  const shown = all ? amounts : amounts.slice(0, 8);
  return (
    <div className="bar-list">
      {shown.map((a) => {
        const act = catalog.activityById.get(a.id);
        const hl = act && catalog.categoryById.get(act.categoryId)?.highlight;
        return (
          <div key={a.id} className="bar-row">
            <div className="bar-head">
              <span className={hl ? 'sns-text' : ''}>{act?.name ?? '（已刪除）'}</span>
              <span className="amount-val">{hours(a.ms)}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${Math.max(2, (a.ms / max) * 100)}%`, background: act?.color ?? '#a3a3a3' }} />
            </div>
          </div>
        );
      })}
      {amounts.length > 8 && (
        <button className="text-btn" onClick={() => setAll(!all)}>
          {all ? '收合' : `顯示全部 ${amounts.length} 項`}
        </button>
      )}
    </div>
  );
}

function StudyCard({ group, activity }: { group: StudyGroup; activity?: Activity }) {
  const [allVocab, setAllVocab] = useState(false);
  const spec = STUDY_FIELDS[group.detailType];
  const vocab = allVocab ? group.vocab : group.vocab.slice(0, 24);
  return (
    <section className="card study-card">
      <div className="study-head">
        <span className="dot" style={{ background: activity?.color }} />
        <b>{activity?.name ?? '（已刪除）'}</b>
        <span className="amount-val">{hours(group.ms)}</span>
      </div>
      {group.titles.map((t) => (
        <div key={t.title} className="study-title">
          <span>《{t.title}》</span>
          <span className="muted">
            {hours(t.ms)}
            {t.progress.length > 0 && ` · ${t.progress.join('、')}`}
          </span>
        </div>
      ))}
      {group.progress.length > 0 && <div className="study-title muted">{(spec.progressLabel ?? '進度') + '：' + group.progress.join('、')}</div>}
      {group.grammar.length > 0 && (
        <div className="study-block">
          <div className="study-sub">文法 {group.grammar.length}</div>
          <div className="tags readonly">
            {group.grammar.map((g) => (
              <span key={g} className="tag">
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
      {group.vocab.length > 0 && (
        <div className="study-block">
          <div className="study-sub">單字 {group.vocab.length}</div>
          <div className="tags readonly">
            {vocab.map((v) => (
              <span key={v} className="tag">
                {v}
              </span>
            ))}
            {group.vocab.length > 24 && (
              <button className="text-btn" onClick={() => setAllVocab(!allVocab)}>
                {allVocab ? '收合' : `全部 ${group.vocab.length} 個`}
              </button>
            )}
          </div>
        </div>
      )}
      {group.titles.length === 0 && group.progress.length === 0 && !group.grammar.length && !group.vocab.length && (
        <div className="muted small">（沒有填寫細節）</div>
      )}
    </section>
  );
}

