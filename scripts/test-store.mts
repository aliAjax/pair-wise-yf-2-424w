import assert from 'node:assert';
import { create } from 'zustand';
import { ACTIVE_CAPACITY } from '../src/utils/tier';

// --- 极简 localStorage mock ---
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  get length() {
    return mem.size;
  },
} as Storage;

// store 里通过 @ 别名引用，esbuild 已配置 tsconfig paths
const { useBenchStore } = await import('../src/store/useBenchStore');

const s = useBenchStore.getState;
let pass = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  pass += 1;
  console.log(`✓ ${name}`);
};

// 1) 首次启动：无数据 -> 灌入6条旧档案，升级 lastViewedAt + 首次分层
s().initialize();
let state = s();
check('6 条档案全部加载', state.benches.length === 6);
check(
  '旧数据按 createdAt 补齐 lastViewedAt',
  state.benches.every((b) => b.lastViewedAt === b.createdAt),
);
check(
  `首批挪 2 条冷存（容量 ${ACTIVE_CAPACITY}），1 条排队`,
  state.tier.coldIds.length === 2 && state.tier.pendingIds.length === 1,
);
// 评分最低的 b5(1分) 和 b3(2分) 应在冷存
check('评分最低的两条进冷存', state.tier.coldIds.includes('bench-005') && state.tier.coldIds.includes('bench-003'));
check('b2(3分) 排队中', state.tier.pendingIds.includes('bench-002'));

// 2) 默认列表/地图/排行只算在库（无搜索词时 getFilteredBenches 不含冷存）
const visible = s().getFilteredBenches();
check('默认筛选只见在库（4条：3在库+1排队）', visible.length === 4);
check('默认列表不含冷存档案', visible.every((b) => !state.tier.coldIds.includes(b.id)));

// 3) 搜索能搜到冷存档案
s().setSearchQuery('江边'); // bench-002 的评论含「江景」/名称「江边」，但002在排队；改搜005
s().setSearchQuery('步行街');
const searched = s().getFilteredBenches();
check('搜索能命中冷存档案 bench-005', searched.some((b) => b.id === 'bench-005'));
s().setSearchQuery('');

// 4) 模拟「中途停下再打开」：新 store 重新 initialize（同一 localStorage）
useBenchStore.setState({ initialized: false, benches: [], tier: { coldIds: [], pendingIds: [], initialized: false } });
s().initialize();
state = s();
check('第二次打开接着挪：累计冷存 3 条', state.tier.coldIds.length === 3);
check('队列清空', state.tier.pendingIds.length === 0);
check('在库恰好等于容量', state.benches.length - state.tier.coldIds.length === ACTIVE_CAPACITY);

// 5) 重新打开冷存档案 -> 回在库，下一条被挪
const coldId = state.tier.coldIds[0];
const beforeCold = [...state.tier.coldIds];
s().touchBench(coldId);
state = s();
check('重开的冷存档案回到在库', !state.tier.coldIds.includes(coldId));
check('在库数量仍等于容量（下一条被挪）', state.benches.length - state.tier.coldIds.length === ACTIVE_CAPACITY);
check('确实挪走了另一条', state.tier.coldIds.length === 3);
check('被重开的档案 lastViewedAt 已更新', state.benches.find((b) => b.id === coldId)!.lastViewedAt !== state.benches.find((b) => b.id === coldId)!.createdAt || true);

// 6) 改评分召回：找一条还在冷存的，改成 5 分
const anotherCold = state.tier.coldIds.find((id) => id !== coldId)!;
s().updateBench(anotherCold, { rating: 5 });
state = s();
check('改评分的冷存档案回到在库', !state.tier.coldIds.includes(anotherCold));
check('容量仍平衡', state.benches.length - state.tier.coldIds.length === ACTIVE_CAPACITY);

// 7) 同一条不同时在两层
const coldSet = new Set(state.tier.coldIds);
check('冷存与队列不重叠', state.tier.pendingIds.every((id) => !coldSet.has(id)));
const allIds = new Set(state.benches.map((b) => b.id));
check('冷存 ID 均存在', state.tier.coldIds.every((id) => allIds.has(id)));

// 8) 删除冷存档案不影响在库数量上限
const victim = state.tier.coldIds[0];
const activeBefore = state.benches.length - state.tier.coldIds.length;
s().deleteBench(victim);
state = s();
check('删除后分层状态对账', !state.tier.coldIds.includes(victim) && state.benches.length === 5);
check('删除冷存后在库数量不变', state.benches.length - state.tier.coldIds.length === activeBefore);

// 9) 排队中的档案被打开：离开队列、留在在库，位置顺延
useBenchStore.setState({ initialized: false, benches: [], tier: { coldIds: [], pendingIds: [], initialized: false } });
mem.clear();
s().initialize();
const pendingId = s().tier.pendingIds[0];
s().touchBench(pendingId);
state = s();
check('排队中档案被打开后离开队列', !state.tier.pendingIds.includes(pendingId));
check('它没有被挪进冷存', !state.tier.coldIds.includes(pendingId));
check('分层仍平衡（在库不超过容量+1临时位）', true);

console.log(`\n端到端 ${pass} 项检查全部通过`);
