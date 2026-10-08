import { db, type Activity, type Category, type DetailType, type Settings, type TimeLedgerDB } from './db';

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  step: 10,
  reminders: [
    { id: 'morning', label: '午餐回顧', periodLabel: '早上', time: '12:30', enabled: true },
    { id: 'afternoon', label: '晚餐回顧', periodLabel: '下午', time: '18:00', enabled: true },
    { id: 'evening', label: '睡前回顧', periodLabel: '晚上', time: '22:30', enabled: true },
  ],
};

const CATEGORIES: Omit<Category, 'order'>[] = [
  { id: 'cat-study', name: '生產/學習', color: '#2563eb', highlight: false },
  { id: 'cat-sport', name: '運動', color: '#16a34a', highlight: false },
  { id: 'cat-life', name: '生活雜務', color: '#d97706', highlight: false },
  { id: 'cat-fun', name: '休息娛樂', color: '#9333ea', highlight: false },
  { id: 'cat-sns', name: 'SNS', color: '#dc2626', highlight: true },
];

const ACTIVITIES: [name: string, categoryId: string, color: string, detailType?: DetailType][] = [
  ['使用 Claude Code 開發小工具', 'cat-study', '#1d4ed8'],
  ['閱讀', 'cat-study', '#0891b2', 'reading'],
  ['讀日文', 'cat-study', '#0d9488', 'japanese'],
  ['讀英文', 'cat-study', '#0284c7', 'english'],
  ['讀醫學書籍', 'cat-study', '#4f46e5', 'medical'],
  ['彈鋼琴', 'cat-study', '#6366f1'],
  ['重訓', 'cat-sport', '#15803d'],
  ['打籃球', 'cat-sport', '#65a30d'],
  ['睡覺', 'cat-life', '#64748b'],
  ['吃正餐', 'cat-life', '#ea580c'],
  ['交通時間', 'cat-life', '#a16207'],
  ['整理房間', 'cat-life', '#ca8a04'],
  ['洗衣服', 'cat-life', '#b45309'],
  ['進行諮商', 'cat-life', '#be185d'],
  ['寫日記/心情札記', 'cat-life', '#db2777'],
  ['玩電腦遊戲', 'cat-fun', '#7c3aed'],
  ['看動畫', 'cat-fun', '#a855f7'],
  ['看 YouTube/Bilibili 影片', 'cat-fun', '#c026d3'],
  ['瀏覽 SNS（Threads, FB, IG, Twitter）', 'cat-sns', '#dc2626'],
];

export function defaultCategories(): Category[] {
  return CATEGORIES.map((c, i) => ({ ...c, order: i }));
}

export function defaultActivities(): Activity[] {
  return ACTIVITIES.map(([name, categoryId, color, detailType], i) => ({
    id: `act-${i + 1}`,
    name,
    categoryId,
    color,
    order: i,
    ...(detailType ? { detailType } : {}),
  }));
}

/** 第一次開啟時寫入預設分類、活動與設定 */
export async function ensureSeeded(database: TimeLedgerDB = db): Promise<void> {
  await database.transaction('rw', [database.categories, database.activities, database.settings], async () => {
    if ((await database.settings.count()) > 0) return;
    await database.categories.bulkAdd(defaultCategories());
    await database.activities.bulkAdd(defaultActivities());
    await database.settings.add(structuredClone(DEFAULT_SETTINGS));
  });
}
