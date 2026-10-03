import type { Bench, StorageTier } from '@/types';

/** 在库容量上限：超过后按优先级把末尾档案分批挪进冷存 */
export const HOT_CAPACITY = 4;

/** 冷存迁移批次大小与批次间隔（毫秒），用于断点续挪时的分批推进 */
export const COLD_BATCH_SIZE = 1;
export const COLD_BATCH_DELAY_MS = 350;

/** 分层状态版本号：历史数据升级或分层规则变化时递增，触发重新分层 */
export const TIER_VERSION = 1;

export interface TierState {
  version: number;
  /** 排队等待挪进冷存的档案 id（按顺序处理，处理一条移除一条） */
  coldQueue: string[];
}

export function createInitialTierState(): TierState {
  return { version: TIER_VERSION, coldQueue: [] };
}

/**
 * 为历史数据补齐分层字段：
 * - 没有最近查看时间时，按创建时间补齐
 * - 没有分层标记时，默认在库（后续分层会重新安排）
 */
export type BenchWithOptionalTier = Omit<Bench, 'storageTier' | 'lastViewedAt'> & {
  storageTier?: StorageTier;
  lastViewedAt?: string;
};

export function withTierDefaults(bench: BenchWithOptionalTier): Bench {
  return {
    ...bench,
    storageTier: bench.storageTier ?? 'hot',
    lastViewedAt: bench.lastViewedAt ?? bench.createdAt,
  };
}

/** 某条档案是否在冷存 */
export function isCold(bench: Bench): boolean {
  return bench.storageTier === 'cold';
}

/**
 * 优先级评分：分数越高越应留在在库。
 * 综合「评分较高」与「最近看过」两个维度：
 * - 评分项：档案综合评分（1-5）
 * - 近因项：最近查看时间越近加分越多（1 天内 +1.5，7 天内 +1，30 天内 +0.5）
 */
export function priorityScore(bench: Bench, now: number = Date.now()): number {
  const rating = bench.rating;
  const viewedAt = new Date(bench.lastViewedAt ?? bench.createdAt).getTime();
  const ageDays = (now - viewedAt) / (1000 * 60 * 60 * 24);

  let recencyBonus = 0;
  if (ageDays <= 1) recencyBonus = 1.5;
  else if (ageDays <= 7) recencyBonus = 1;
  else if (ageDays <= 30) recencyBonus = 0.5;

  return rating + recencyBonus;
}

/**
 * 优先级比较器：优先级高的排前面。
 * 先按优先级分数，再按最近查看时间，最后按创建时间。
 */
export function comparePriority(a: Bench, b: Bench, now: number = Date.now()): number {
  const scoreDiff = priorityScore(b, now) - priorityScore(a, now);
  if (scoreDiff !== 0) return scoreDiff;

  const viewedDiff =
    new Date(b.lastViewedAt ?? b.createdAt).getTime() -
    new Date(a.lastViewedAt ?? a.createdAt).getTime();
  if (viewedDiff !== 0) return viewedDiff;

  return b.createdAt.localeCompare(a.createdAt);
}

export interface LayeringPlan {
  /** 应留在在库的档案 id（按优先级从高到低） */
  hotIds: string[];
  /** 应分批挪进冷存的档案 id（优先级从低到高，队首最先被挪走） */
  coldQueue: string[];
}

/**
 * 制定一次分层计划：
 * 把当前所有在库档案按优先级排序，前 HOT_CAPACITY 条留在在库，
 * 其余排进冷存迁移队列。已经在冷存的档案不参与重新排队。
 */
export function planLayering(benches: Bench[], now: number = Date.now()): LayeringPlan {
  const hotBenches = benches.filter((b) => b.storageTier !== 'cold');
  const ranked = [...hotBenches].sort((a, b) => comparePriority(a, b, now));

  const hotIds = ranked.slice(0, HOT_CAPACITY).map((b) => b.id);
  const coldQueue = ranked.slice(HOT_CAPACITY).map((b) => b.id);

  return { hotIds, coldQueue };
}

/**
 * 从在库档案中选出需要挪进冷存的档案（按优先级从低到高），
 * 可指定受保护的档案 id（正在查看的不能被动）以及已在排队的 id（不重复排队）。
 */
export function pickEvictions(
  benches: Bench[],
  protectId?: string,
  queuedIds: string[] = [],
  now: number = Date.now()
): string[] {
  const queued = new Set(queuedIds);
  const hotAll = benches.filter((b) => b.storageTier !== 'cold');
  // 可挪动的档案：排除正在查看（受保护）和已在排队的
  const movable = hotAll
    .filter((b) => b.id !== protectId && !queued.has(b.id))
    .sort((a, b) => comparePriority(a, b, now));

  // 超出在库容量的部分需要挪进冷存；受保护的档案占一个名额
  let excess = hotAll.length - HOT_CAPACITY;
  const evicted: string[] = [];
  // movable 已按优先级从高到低排序，从末尾（优先级最低）开始挪
  for (let i = movable.length - 1; i >= 0 && excess > 0; i--) {
    evicted.push(movable[i].id);
    excess--;
  }
  return evicted;
}

/** 计算当前在库数量 */
export function countHot(benches: Bench[]): number {
  return benches.filter((b) => b.storageTier !== 'cold').length;
}

/** 计算当前冷存数量 */
export function countCold(benches: Bench[]): number {
  return benches.filter((b) => b.storageTier === 'cold').length;
}

export type { StorageTier };
