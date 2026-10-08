import { db, type DetailType, type StudyDetails } from './db';

export interface StudyFieldSpec {
  titleLabel: string;
  titlePlaceholder: string;
  progressLabel?: string;
  progressPlaceholder?: string;
  /** 語言類：文法、單字 */
  language?: boolean;
}

export const STUDY_FIELDS: Record<DetailType, StudyFieldSpec> = {
  reading: { titleLabel: '書名', titlePlaceholder: '讀了哪本書', progressLabel: '頁數或章節', progressPlaceholder: '例如 p.30–58、第 3 章' },
  japanese: { titleLabel: '教材', titlePlaceholder: '例如 大家的日本語', language: true },
  english: { titleLabel: '教材', titlePlaceholder: '例如 Vocabulary in Use', language: true },
  medical: { titleLabel: '書名', titlePlaceholder: '例如 Harrison', progressLabel: '章節／主題', progressPlaceholder: '例如 心衰竭' },
};

export const DETAIL_TYPE_LABEL: Record<DetailType, string> = {
  reading: '閱讀',
  japanese: '日文',
  english: '英文',
  medical: '醫學',
};

/** 去掉空白欄位；全部空白時回傳 undefined */
export function cleanStudy(d: StudyDetails | undefined): StudyDetails | undefined {
  if (!d) return undefined;
  const out: StudyDetails = {};
  const title = d.title?.trim();
  const progress = d.progress?.trim();
  const grammar = (d.grammar ?? []).map((x) => x.trim()).filter(Boolean);
  const vocab = (d.vocab ?? []).map((x) => x.trim()).filter(Boolean);
  if (title) out.title = title;
  if (progress) out.progress = progress;
  if (grammar.length) out.grammar = grammar;
  if (vocab.length) out.vocab = vocab;
  return Object.keys(out).length ? out : undefined;
}

/** 一次貼上多個時，用逗號、頓號或換行分開 */
export function splitTags(text: string): string[] {
  return text
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const titleKey = (t: DetailType) => `titles:${t}`;
const MAX_TITLES = 30;

/** 記住用過的書名／教材，最近用過的排前面 */
export async function rememberTitle(type: DetailType, title: string | undefined): Promise<void> {
  const t = title?.trim();
  if (!t) return;
  const cur = ((await db.kv.get(titleKey(type)))?.value as string[] | undefined) ?? [];
  await db.kv.put({ key: titleKey(type), value: [t, ...cur.filter((x) => x !== t)].slice(0, MAX_TITLES) });
}

export async function forgetTitle(type: DetailType, title: string): Promise<void> {
  const cur = ((await db.kv.get(titleKey(type)))?.value as string[] | undefined) ?? [];
  await db.kv.put({ key: titleKey(type), value: cur.filter((x) => x !== title) });
}

export async function recentTitles(type: DetailType): Promise<string[]> {
  return ((await db.kv.get(titleKey(type)))?.value as string[] | undefined) ?? [];
}

/** 紀錄的簡短說明：同時進行的活動、書名等，用於時間軸與清單 */
export function entrySummary(
  e: { details?: StudyDetails; secondary?: { activityId: string; detail?: string; study?: StudyDetails }[]; note?: string },
  nameOf: (id: string) => string | undefined,
): string {
  const parts: string[] = [];
  const d = e.details;
  if (d?.title) parts.push(`《${d.title}》${d.progress ? ` ${d.progress}` : ''}`);
  else if (d?.progress) parts.push(d.progress);
  if (d?.vocab?.length) parts.push(`單字 ${d.vocab.length}`);
  if (d?.grammar?.length) parts.push(`文法 ${d.grammar.length}`);
  for (const s of e.secondary ?? []) {
    const extra = s.study?.title ? `《${s.study.title}》` : s.detail ? `：${s.detail}` : '';
    parts.push(`＋${nameOf(s.activityId) ?? '?'}${extra}`);
  }
  if (e.note) parts.push(e.note);
  return parts.join(' · ');
}
