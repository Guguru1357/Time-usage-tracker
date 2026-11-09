import { db, uid, type Activity, type Plan, type PlanResult, type PlanStudy, type WorkoutSet } from './db';
import { deleteEntry, saveEntry } from './repo';
import { rememberTitle } from './study';
import { MIN, addDays, dayStart, parseHM } from './time';

export const MUSCLE_GROUPS = ['胸', '背', '肩', '腿', '臀', '二頭', '三頭', '核心', '有氧'];
/** 沒填長度時，記到時間軸用的預設長度 */
export const DEFAULT_PLAN_MIN = 60;

export type PlanInput = Omit<Plan, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export async function plansForDate(date: string): Promise<Plan[]> {
  const list = await db.plans.where('date').equals(date).toArray();
  return list.sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt);
}

export async function savePlan(data: PlanInput): Promise<Plan> {
  const now = Date.now();
  const existing = data.id ? await db.plans.get(data.id) : undefined;
  const plan: Plan = { ...existing, ...data, id: data.id ?? uid(), createdAt: existing?.createdAt ?? now, updatedAt: now };
  await db.plans.put(plan);
  return plan;
}

export async function deletePlan(id: string): Promise<void> {
  await db.plans.delete(id);
}

export function planStart(p: Pick<Plan, 'date' | 'time'>): number {
  return dayStart(p.date) + parseHM(p.time) * MIN;
}

/** 頁數範圍或進度的文字，例如「p.30–55」 */
export function studyProgressText(s: PlanStudy | undefined): string {
  if (!s) return '';
  if (s.pageFrom != null && s.pageTo != null) return `p.${s.pageFrom}–${s.pageTo}`;
  if (s.pageFrom != null) return `從 p.${s.pageFrom}`;
  if (s.pageTo != null) return `到 p.${s.pageTo}`;
  return s.progress?.trim() ?? '';
}

export function studyText(s: PlanStudy | undefined): string {
  if (!s) return '';
  const progress = studyProgressText(s);
  return [s.title?.trim() && `《${s.title.trim()}》`, progress].filter(Boolean).join(' ');
}

export function setText(w: WorkoutSet): string {
  const parts = [w.weight != null ? `${w.weight}kg` : '', w.reps != null ? `${w.reps}下` : '', w.sets != null ? `${w.sets}組` : '']
    .filter(Boolean)
    .join(' × ');
  return parts ? `${w.exercise} ${parts}` : w.exercise;
}

/** 安排的目標摘要 */
export function targetText(p: Plan): string {
  const parts: string[] = [];
  const study = studyText(p.study);
  if (study) parts.push(study);
  if (p.muscles?.length) parts.push(p.muscles.join('・'));
  if (p.targetSets) parts.push(`${p.targetSets} 組`);
  if (p.note) parts.push(p.note);
  return parts.join(' · ');
}

/** 完成時寫下的結果摘要 */
export function resultText(r: PlanResult | undefined): string {
  if (!r) return '';
  const parts: string[] = [];
  const study = studyText(r.study);
  if (study) parts.push(study);
  if (r.workout?.length) parts.push(r.workout.map(setText).join('、'));
  if (r.note) parts.push(r.note);
  return parts.join(' · ');
}

/** 去掉沒填動作名稱的列與空值 */
export function cleanWorkout(list: WorkoutSet[] | undefined): WorkoutSet[] | undefined {
  const num = (v: number | undefined) => (v != null && Number.isFinite(v) && v > 0 ? v : undefined);
  const out = (list ?? [])
    .map((w) => ({ exercise: w.exercise.trim(), weight: num(w.weight), reps: num(w.reps), sets: num(w.sets) }))
    .filter((w) => w.exercise)
    .map((w) => Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined)) as unknown as WorkoutSet);
  return out.length ? out : undefined;
}

export function cleanPlanStudy(s: PlanStudy | undefined): PlanStudy | undefined {
  if (!s) return undefined;
  const out: PlanStudy = {};
  if (s.title?.trim()) out.title = s.title.trim();
  if (s.pageFrom != null && Number.isFinite(s.pageFrom)) out.pageFrom = s.pageFrom;
  if (s.pageTo != null && Number.isFinite(s.pageTo)) out.pageTo = s.pageTo;
  if (s.progress?.trim()) out.progress = s.progress.trim();
  return Object.keys(out).length ? out : undefined;
}

// ---------- 用過的重訓動作 ----------

const EXERCISE_KEY = 'exercises';
const MAX_EXERCISES = 40;

export async function recentExercises(): Promise<string[]> {
  return ((await db.kv.get(EXERCISE_KEY))?.value as string[] | undefined) ?? [];
}

async function rememberExercises(names: string[]): Promise<void> {
  if (!names.length) return;
  const cur = await recentExercises();
  await db.kv.put({ key: EXERCISE_KEY, value: [...new Set([...names, ...cur])].slice(0, MAX_EXERCISES) });
}

/** 最近一次練到相同肌群的紀錄，用來預先帶入動作 */
export async function lastWorkout(muscles: string[] | undefined, excludeId?: string): Promise<WorkoutSet[] | undefined> {
  const done = (await db.plans.toArray())
    .filter((p) => p.id !== excludeId && p.doneAt && p.result?.workout?.length)
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const want = new Set(muscles ?? []);
  const match = want.size ? done.find((p) => p.muscles?.some((m) => want.has(m))) : done[0];
  return match?.result?.workout;
}

// ---------- 完成 / 取消完成 ----------

export interface CompleteOptions {
  result?: PlanResult;
  /** 同時記到時間軸 */
  logEntry: boolean;
  activity?: Activity;
}

export async function completePlan(plan: Plan, opts: CompleteOptions): Promise<Plan> {
  const result: PlanResult | undefined = opts.result
    ? Object.fromEntries(
        Object.entries({
          study: cleanPlanStudy(opts.result.study),
          workout: cleanWorkout(opts.result.workout),
          note: opts.result.note?.trim() || undefined,
        }).filter(([, v]) => v !== undefined),
      )
    : undefined;
  const hasResult = result && Object.keys(result).length > 0;

  let entryId = plan.entryId;
  if (opts.logEntry && plan.activityId && !entryId) {
    const start = planStart(plan);
    const study = result?.study ?? plan.study;
    const progress = studyProgressText(study);
    const entry = await saveEntry({
      start,
      end: start + (plan.durationMin || DEFAULT_PLAN_MIN) * MIN,
      activityId: plan.activityId,
      details: opts.activity?.detailType && (study?.title || progress) ? { title: study?.title, progress: progress || undefined } : undefined,
      note: [result?.workout?.map(setText).join('、'), result?.note].filter(Boolean).join(' · ') || undefined,
    });
    entryId = entry.id;
  }

  if (opts.activity?.detailType) await rememberTitle(opts.activity.detailType, (result?.study ?? plan.study)?.title);
  if (result?.workout) await rememberExercises(result.workout.map((w) => w.exercise));

  return savePlan({ ...plan, doneAt: Date.now(), result: hasResult ? result : undefined, entryId });
}

export async function uncompletePlan(plan: Plan): Promise<Plan> {
  if (plan.entryId) await deleteEntry(plan.entryId);
  const { doneAt: _d, result: _r, entryId: _e, ...rest } = plan;
  const next = { ...rest, updatedAt: Date.now() } as Plan;
  await db.plans.put(next);
  return next;
}

/** 把某天的安排複製到另一天（不含完成狀態） */
export async function copyPlans(from: string, to: string): Promise<number> {
  const src = await plansForDate(from);
  const now = Date.now();
  const copies: Plan[] = src.map(({ doneAt: _d, result: _r, entryId: _e, ...p }) => ({
    ...p,
    id: uid(),
    date: to,
    createdAt: now,
    updatedAt: now,
  }));
  await db.plans.bulkAdd(copies);
  return copies.length;
}

/** 往前找最近一天有安排的日期（預設找 14 天內） */
export async function previousPlanDate(date: string, days = 14): Promise<string | undefined> {
  const keys = (await db.plans.where('date').between(addDays(date, -days), date, true, false).toArray()).map((p) => p.date);
  return keys.sort().pop();
}
