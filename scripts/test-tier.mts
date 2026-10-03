import assert from 'node:assert';
import {
  ACTIVE_CAPACITY,
  MIGRATION_BATCH_SIZE,
  EMPTY_TIER_STATE,
  planTierMigration,
  moveToActive,
  pruneTierState,
} from '../src/utils/tier';
import type { Bench } from '../src/types';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

function makeBench(id: string, rating: number, viewedAt: string, createdAt = viewedAt): Bench {
  return {
    id,
    name: id,
    location: '',
    lat: 0,
    lng: 0,
    material: 'wood',
    orientation: 'south',
    hasBackrest: true,
    shadeLevel: 'full',
    noiseLevel: 'quiet',
    stayDuration: 'medium',
    rating,
    review: '',
    experiences: [],
    createdAt,
    updatedAt: createdAt,
    lastViewedAt: viewedAt,
  };
}

// 6 条旧数据（等价于升级后按 createdAt 补 lastViewedAt 的种子）
const benches: Bench[] = [
  makeBench('b1', 5, '2024-01-15T10:30:00Z'),
  makeBench('b2', 3, '2024-02-10T08:15:00Z'),
  makeBench('b3', 2, '2024-03-05T16:45:00Z'),
  makeBench('b4', 4, '2024-01-28T09:00:00Z'),
  makeBench('b5', 1, '2024-03-12T12:30:00Z'),
  makeBench('b6', 5, '2024-02-20T15:00:00Z'),
];
// 驱逐顺序（评分升序 -> 查看时间升序）：b5(1), b3(2), b2(3), b4(4), b1(5,1月), b6(5,2月)
const evictionOrder = ['b5', 'b3', 'b2', 'b4', 'b1', 'b6'];

function assertPartition(tier: { coldIds: string[]; pendingIds: string[] }, total: number) {
  // 同一条不能同时留在两层；冷存 + 在库（含排队中）恰好覆盖全部
  const overlap = tier.coldIds.filter((id) => tier.pendingIds.includes(id));
  assert.deepStrictEqual(overlap, []);
  assert.strictEqual(new Set(tier.coldIds).size, tier.coldIds.length, '冷存 ID 去重');
  assert.strictEqual(new Set(tier.pendingIds).size, tier.pendingIds.length, '队列 ID 去重');
  assert.ok(coldIdsInData(tier, total), '冷存 ID 不越界');
}

function coldIdsInData(tier: { coldIds: string[] }, total: number): boolean {
  // 简化校验：测试用 ID 均为 b1..bN
  return tier.coldIds.every((id) => {
    const n = Number(id.slice(1));
    return n >= 1 && n <= total;
  });
}

function assertAtCapacity(tier: { coldIds: string[] }, total: number) {
  // 队列清空后，在库必须恰好等于容量（有足够档案时）
  assert.strictEqual(total - tier.coldIds.length, ACTIVE_CAPACITY);
}

test('首次分层：容量3、批次2，先挪2条进冷存，剩下排队（排队期间仍在库）', () => {
  const tier = planTierMigration(benches, EMPTY_TIER_STATE);
  assert.deepStrictEqual(tier.coldIds, evictionOrder.slice(0, MIGRATION_BATCH_SIZE));
  assert.deepStrictEqual(tier.pendingIds, ['b2']);
  assert.strictEqual(tier.initialized, true);
  assertPartition(tier, benches.length);
});

test('中途停下再打开：从队列接着挪，直到冷存数恰好等于超出量', () => {
  let tier = planTierMigration(benches, EMPTY_TIER_STATE);
  tier = planTierMigration(benches, tier);
  assert.deepStrictEqual(tier.coldIds, ['b5', 'b3', 'b2']);
  assert.deepStrictEqual(tier.pendingIds, []);
  assert.strictEqual(benches.length - tier.coldIds.length, ACTIVE_CAPACITY);

  // 再跑也不会多挪（在库不低于容量）
  const again = planTierMigration(benches, tier);
  assert.deepStrictEqual(again.coldIds, tier.coldIds);
});

test('同一条不会同时留在两层', () => {
  const tier = planTierMigration(benches, EMPTY_TIER_STATE);
  assertPartition(tier, benches.length);
  const stable = planTierMigration(benches, planTierMigration(benches, tier));
  assertPartition(stable, benches.length);
});

test('正在查看的档案不能被挪走（为它保留名额），保护结束后再挪', () => {
  const tier = planTierMigration(benches, EMPTY_TIER_STATE, 'b5');
  assert.ok(!tier.coldIds.includes('b5'));
  // b5 自然排序第一但受保护：本批挪 b3、b2，第三个名额留给它延后，不补别人
  assert.deepStrictEqual(tier.coldIds, ['b3', 'b2']);
  assert.deepStrictEqual(tier.pendingIds, []);
  assertPartition(tier, benches.length);

  // 下次打开（不再查看它）：b5 正常进候选被挪，在库回到容量
  const next = planTierMigration(benches, tier);
  assert.deepStrictEqual(next.coldIds, ['b3', 'b2', 'b5']);
  assert.deepStrictEqual(next.pendingIds, []);
  assertAtCapacity(next, benches.length);
});

test('冷存档案重新打开回到在库，多出来的位置挪给下一条，查看者受保护', () => {
  let tier = planTierMigration(benches, EMPTY_TIER_STATE);
  tier = planTierMigration(benches, tier); // 冷存 b5,b3,b2；在库 b1,b4,b6
  const reopened = benches.map((b) =>
    b.id === 'b5' ? { ...b, lastViewedAt: '2026-10-03T00:00:00Z' } : b,
  );
  tier = moveToActive(tier, 'b5');
  tier = planTierMigration(reopened, tier, 'b5', 'b5');
  assert.ok(!tier.coldIds.includes('b5'), '重新打开 -> 回在库');
  assert.ok(tier.coldIds.includes('b4'), '空出的位置挪给下一条 b4');
  assert.strictEqual(reopened.length - tier.coldIds.length, ACTIVE_CAPACITY);
  assertPartition(tier, reopened.length);
});

test('改评分的冷存档案回在库，编辑者本人不会在同一次平衡中被挪走', () => {
  let tier = planTierMigration(benches, EMPTY_TIER_STATE); // 冷 b5,b3；排队 b2
  tier = planTierMigration(benches, tier); // 冷 b5,b3,b2
  const edited = benches.map((b) => (b.id === 'b5' ? { ...b, rating: 5 } : b));
  tier = moveToActive(tier, 'b5');
  tier = planTierMigration(edited, tier, 'b5', 'b5');
  assert.ok(!tier.coldIds.includes('b5'));
  assert.ok(tier.coldIds.includes('b4'));
  assert.strictEqual(edited.length - tier.coldIds.length, ACTIVE_CAPACITY);
});

test('删档后队列对账：删掉在库档案后排队者继续按批迁移', () => {
  // 首轮后：冷 b5,b3；排队 b2（在库 b1,b2,b4,b6）
  let tier = planTierMigration(benches, EMPTY_TIER_STATE);
  // 删掉在库非排队的 b6 -> 剩5条，仍超容1，b2 本批被挪
  const afterDelete = benches.filter((b) => b.id !== 'b6');
  tier = planTierMigration(afterDelete, pruneTierState(tier, new Set(afterDelete.map((b) => b.id))));
  assert.deepStrictEqual(tier.pendingIds, []);
  assert.ok(tier.coldIds.includes('b2'));
  assert.strictEqual(afterDelete.length - tier.coldIds.length, 2);
});

test('删除冷存档案后，队列里的下一条补进冷存', () => {
  let tier = planTierMigration(benches, EMPTY_TIER_STATE); // 冷 b5,b3，排队 b2
  const afterDelete = benches.filter((b) => b.id !== 'b5');
  tier = planTierMigration(afterDelete, pruneTierState(tier, new Set(afterDelete.map((b) => b.id))));
  assert.ok(!tier.coldIds.includes('b5'));
  assert.ok(tier.coldIds.includes('b2'), 'b2 补进冷存');
  assert.strictEqual(afterDelete.length - tier.coldIds.length, ACTIVE_CAPACITY);
});

test('新增档案先进在库；在库满时按优先级补排/补挪', () => {
  // 稳定态：冷 b5,b3,b2；在库 b1,b4,b6
  let tier = planTierMigration(benches, planTierMigration(benches, EMPTY_TIER_STATE));
  const withNew = [...benches, makeBench('b7', 1, '2026-10-03T08:00:00Z')];
  tier = planTierMigration(withNew, tier);
  // b7 评分1、刚刚查看 —— 新档案先在库；超出量1，队列里按优先级 b7(评分1) 最靠前，本批挪走 b7
  assert.ok(tier.coldIds.includes('b7'));
  assert.strictEqual(withNew.length - tier.coldIds.length, ACTIVE_CAPACITY);
  assertPartition(tier, withNew.length);
});

test('迁移幂等：稳定后重复执行结果不变', () => {
  let tier = planTierMigration(benches, EMPTY_TIER_STATE);
  tier = planTierMigration(benches, tier);
  const snap = JSON.stringify(tier);
  assert.strictEqual(JSON.stringify(planTierMigration(benches, tier)), snap);
  assert.strictEqual(JSON.stringify(planTierMigration(benches, JSON.parse(snap))), snap);
});

test('查看在库档案时，已有的排队项不丢失', () => {
  // 首轮后：冷 b5,b3；排队 [b2]
  const first = planTierMigration(benches, EMPTY_TIER_STATE);
  // 此时打开一条在库非排队档案 b1（受保护，但它评分高、自然排序靠后，本就安全）
  const next = planTierMigration(benches, first, 'b1');
  assert.ok(!next.coldIds.includes('b1'));
  // b2 照常从队列被挪，不需要为安全的 b1 保留名额
  assert.deepStrictEqual(next.coldIds, ['b5', 'b3', 'b2']);
  assert.deepStrictEqual(next.pendingIds, []);
});

test('FIFO 续挪：已有队列保持顺序，新候选补在后面', () => {
  // 真实中间态：冷 b5,b3，排队 [b2]
  const first = planTierMigration(benches, EMPTY_TIER_STATE);
  assert.deepStrictEqual(first.coldIds, ['b5', 'b3']);
  assert.deepStrictEqual(first.pendingIds, ['b2']);

  // 再加一个评分更低的新档案（优先级最高），它补在已有排队项后面
  const withWorse = [...benches, makeBench('b0', 0, '2026-10-03T00:00:00Z')];
  const run = planTierMigration(withWorse, first);
  // 本批先挪 FIFO 队首 b2，再挪新候选 b0
  assert.deepStrictEqual(run.coldIds, ['b5', 'b3', 'b2', 'b0']);
  assert.deepStrictEqual(run.pendingIds, []);
});

console.log(`\n全部 ${passed} 个测试通过`);
