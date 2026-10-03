import type { Bench } from '@/types';

/** 在库容量上限：只保留最近看过或评分较高的档案 */
export const ACTIVE_CAPACITY = 3;
/** 每批挪入冷存的数量，没挪完的排队等下次再挪 */
export const MIGRATION_BATCH_SIZE = 2;

/**
 * 冷存分层状态。
 * coldIds 为冷存档案 ID；pendingIds 为已确定要挪但尚未挪完的排队 ID
 * （排队期间仍算在库，下次打开时接着挪）。
 * 在库 ID 不单独存储，由「全部 ID − coldIds」推出，
 * 因此同一条档案不可能同时留在两层。
 */
export interface TierState {
  coldIds: string[];
  pendingIds: string[];
  /** 是否已完成旧数据的首次分层 */
  initialized: boolean;
}

export const EMPTY_TIER_STATE: TierState = {
  coldIds: [],
  pendingIds: [],
  initialized: false,
};

/**
 * 驱逐候选排序：越靠前越应该先挪进冷存。
 * 在库保留「评分较高」和「最近看过」的，因此按
 * 评分升序 → 最近查看时间升序 → 创建时间升序 → ID 兜底。
 */
export function compareEvictionPriority(a: Bench, b: Bench): number {
  if (a.rating !== b.rating) return a.rating - b.rating;
  const viewedDiff =
    new Date(a.lastViewedAt).getTime() - new Date(b.lastViewedAt).getTime();
  if (viewedDiff !== 0) return viewedDiff;
  const createdDiff =
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdDiff !== 0) return createdDiff;
  return a.id.localeCompare(b.id);
}

/**
 * 计算一次分层。
 *
 * 「需要离开在库」的档案总数 overflow = 总量 − 容量，其中一部分已在
 * coldIds，其余进入待挪队列：已排队的保持 FIFO，新候选按驱逐优先级
 * 补齐。每批最多挪 MIGRATION_BATCH_SIZE 条进冷存，没挪完的留在
 * pendingIds，下次再调用时接着挪（排队期间仍算在库）。
 *
 * protectedId 指向「正在查看/编辑」的档案，本轮一定不能被动。
 * 两种受保护语义：
 * - 默认（仅 protectedId）：它按自然排序本就该挪时，为它保留名额、
 *   冷存延后到保护期结束，且不用别人顶替（容量暂时少冷一条）；
 * - reopenedId（刚从冷存召回）：它确定留在在库，多出来的冷存名额
 *   立即顺延给自然排序的下一条。
 */
export function planTierMigration(
  benches: Bench[],
  state: TierState,
  protectedId: string | null = null,
  reopenedId: string | null = null,
): TierState {
  const coldIds = new Set(state.coldIds);
  const byId = new Map(benches.map((bench) => [bench.id, bench]));

  // 需要离开在库的总数 = 已冷存 + 待排队
  const overflow = Math.max(0, benches.length - ACTIVE_CAPACITY);

  // 1) 已排队的有效 ID（FIFO）
  const queuedIds: string[] = [];
  const queuedSet = new Set<string>();
  for (const id of state.pendingIds) {
    if (!byId.has(id) || coldIds.has(id) || queuedSet.has(id)) continue;
    queuedIds.push(id);
    queuedSet.add(id);
  }

  const reopenedActive =
    reopenedId !== null &&
    byId.has(reopenedId) &&
    !coldIds.has(reopenedId);
  const protectedActive =
    protectedId !== null &&
    byId.has(protectedId) &&
    !coldIds.has(protectedId) &&
    !(reopenedActive && reopenedId === protectedId);

  // 2) 本轮还需新补的候选名额。
  // 重新召回的档案确定占一个在库名额，不保留冷存名额（由别人顶替）；
  // 普通受保护档案延后时为它保留一个名额（少补一条）。
  const baseOpen = overflow - coldIds.size - queuedIds.length;
  let reservedSlot = false;
  let openSlots: number;
  if (reopenedActive) {
    openSlots = Math.max(0, baseOpen);
  } else if (protectedActive) {
    // 仅当受保护者按自然排序本就落在候选范围内，才需要保留名额
    const naturalCandidates = benches
      .filter(
        (bench) => !coldIds.has(bench.id) && !queuedSet.has(bench.id),
      )
      .sort(compareEvictionPriority);
    const rank = naturalCandidates.findIndex((bench) => bench.id === protectedId);
    reservedSlot = rank >= 0 && rank < baseOpen;
    openSlots = Math.max(0, baseOpen - (reservedSlot ? 1 : 0));
  } else {
    openSlots = Math.max(0, baseOpen);
  }

  // 3) 新候选（排除受保护者与刚召回者）按优先级补齐
  const filled = benches
    .filter(
      (bench) =>
        !coldIds.has(bench.id) &&
        !queuedSet.has(bench.id) &&
        bench.id !== protectedId &&
        bench.id !== reopenedId,
    )
    .sort(compareEvictionPriority)
    .slice(0, openSlots)
    .map((bench) => bench.id);

  // 4) 本轮处理序列
  const runQueue = [...queuedIds, ...filled];

  let moved = 0;
  const stillPending: string[] = [];
  for (const id of runQueue) {
    if (moved < MIGRATION_BATCH_SIZE && !coldIds.has(id)) {
      coldIds.add(id);
      moved += 1;
    } else {
      stillPending.push(id);
    }
  }

  // 5) 持久队列长度 = 仍需离开在库但尚未冷存的数量；
  //    为普通受保护者保留的名额不计入队列（它保护期结束后重新参选）
  const pendingTarget = Math.max(
    0,
    overflow - coldIds.size - (reservedSlot ? 1 : 0),
  );
  return {
    coldIds: [...coldIds],
    pendingIds: stillPending.slice(0, pendingTarget),
    initialized: true,
  };
}

/** 冷存档案被重新打开或改了评分后回到在库：移出冷存与待挪队列 */
export function moveToActive(state: TierState, id: string): TierState {
  if (!state.coldIds.includes(id) && !state.pendingIds.includes(id)) {
    return state;
  }
  return {
    ...state,
    coldIds: state.coldIds.filter((coldId) => coldId !== id),
    pendingIds: state.pendingIds.filter((pendingId) => pendingId !== id),
  };
}

/** 删除档案后清理分层里残留的 ID */
export function pruneTierState(state: TierState, validIds: Set<string>): TierState {
  return {
    ...state,
    coldIds: state.coldIds.filter((id) => validIds.has(id)),
    pendingIds: state.pendingIds.filter((id) => validIds.has(id)),
  };
}
