import { create } from 'zustand';
import type { Bench, BenchExperience, MaterialType, OrientationType, ShadeLevelType, NoiseLevelType } from '@/types';
import { loadBenches, saveBenches, loadTierState, saveTierState } from '@/utils/storage';
import { generateId } from '@/utils/comfort';
import { mockBenches } from '@/data/mockBenches';
import {
  HOT_CAPACITY,
  COLD_BATCH_SIZE,
  COLD_BATCH_DELAY_MS,
  TIER_VERSION,
  withTierDefaults,
  planLayering,
  pickEvictions,
} from '@/utils/tier';

interface ColdMigrationState {
  active: boolean;
  moved: number;
  total: number;
}

interface BenchState {
  benches: Bench[];
  searchQuery: string;
  materialFilter: MaterialType | null;
  orientationFilter: OrientationType | null;
  shadeFilter: ShadeLevelType | null;
  noiseFilter: NoiseLevelType | null;
  initialized: boolean;
  /** 排队等待挪进冷存的档案 id（按顺序处理） */
  coldQueue: string[];
  /** 冷存迁移进度（用于界面提示） */
  coldMigration: ColdMigrationState;
}

interface BenchActions {
  initialize: () => void;
  setSearchQuery: (query: string) => void;
  setMaterialFilter: (material: MaterialType | null) => void;
  setOrientationFilter: (orientation: OrientationType | null) => void;
  setShadeFilter: (shade: ShadeLevelType | null) => void;
  setNoiseFilter: (noise: NoiseLevelType | null) => void;
  clearFilters: () => void;
  addBench: (bench: Omit<Bench, 'id' | 'createdAt' | 'updatedAt' | 'experiences' | 'storageTier' | 'lastViewedAt'>) => void;
  updateBench: (id: string, updates: Partial<Bench>) => void;
  deleteBench: (id: string) => void;
  getBenchById: (id: string) => Bench | undefined;
  addExperience: (benchId: string, experience: Omit<BenchExperience, 'id' | 'benchId'>) => void;
  updateExperience: (benchId: string, expId: string, updates: Partial<BenchExperience>) => void;
  deleteExperience: (benchId: string, expId: string) => void;
  getFilteredBenches: () => Bench[];
  getHotBenches: () => Bench[];
  getColdBenches: () => Bench[];
  /** 记录一次查看：更新最近查看时间；冷存档案被查看后回到在库 */
  recordBenchView: (id: string) => void;
  /** 处理冷存迁移队列（分批挪入，中途停下后再次调用可接着挪） */
  processColdQueue: () => Promise<void>;
  /** 在库超容量时，把最低优先级的档案挪进冷存（可指定正在查看、不能被动的档案） */
  enforceCapacity: (protectId?: string) => void;
}

const initialState: BenchState = {
  benches: [],
  searchQuery: '',
  materialFilter: null,
  orientationFilter: null,
  shadeFilter: null,
  noiseFilter: null,
  initialized: false,
  coldQueue: [],
  coldMigration: { active: false, moved: 0, total: 0 },
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useBenchStore = create<BenchState & BenchActions>((set, get) => ({
  ...initialState,

  initialize: () => {
    if (get().initialized) return;

    let stored = loadBenches();
    let legacy = false;

    if (stored.length > 0) {
      // 升级：历史数据缺少最近查看时间 / 分层标记，按创建时间补齐并补默认分层
      if (stored.some((b) => b.lastViewedAt === undefined || b.storageTier === undefined)) {
        stored = stored.map(withTierDefaults);
        legacy = true;
        saveBenches(stored);
      }
    } else {
      stored = mockBenches.map(withTierDefaults);
      legacy = true;
      saveBenches(stored);
    }

    const tierState = loadTierState();
    let coldQueue = tierState.coldQueue;

    // 首次升级或分层版本变化时，做一次分层：在库留最近看过 / 评分较高的，其余排队挪进冷存
    if (legacy || tierState.version < TIER_VERSION) {
      const plan = planLayering(stored);
      coldQueue = plan.coldQueue;
      saveTierState({ version: TIER_VERSION, coldQueue });
    }

    // 清理队列中已不存在的档案
    coldQueue = coldQueue.filter((id) => stored.some((b) => b.id === id));

    set({ benches: stored, initialized: true, coldQueue });

    // 断点续挪：上次没挪完的，打开后接着挪
    get().processColdQueue();
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setMaterialFilter: (material) => set({ materialFilter: material }),
  setOrientationFilter: (orientation) => set({ orientationFilter: orientation }),
  setShadeFilter: (shade) => set({ shadeFilter: shade }),
  setNoiseFilter: (noise) => set({ noiseFilter: noise }),

  clearFilters: () => set({
    searchQuery: '',
    materialFilter: null,
    orientationFilter: null,
    shadeFilter: null,
    noiseFilter: null,
  }),

  addBench: (benchData) => {
    const now = new Date().toISOString();
    const newBench: Bench = {
      ...benchData,
      id: generateId(),
      experiences: [],
      storageTier: 'hot',
      lastViewedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const newBenches = [newBench, ...get().benches];
    set({ benches: newBenches });
    saveBenches(newBenches);

    // 新档案进入在库后若超容量，把多出来的位置挪给下一条（最低优先级进冷存）
    get().enforceCapacity();
  },

  updateBench: (id, updates) => {
    const now = new Date().toISOString();
    const state = get();
    const target = state.benches.find((bench) => bench.id === id);

    let newBenches = state.benches.map((bench) =>
      bench.id === id
        ? { ...bench, ...updates, updatedAt: now }
        : bench
    );
    let coldQueue = state.coldQueue;

    // 冷存档案改了评分后回到在库
    const ratingChanged = updates.rating !== undefined && updates.rating !== target?.rating;
    if (target?.storageTier === 'cold' && ratingChanged) {
      newBenches = newBenches.map((bench) =>
        bench.id === id ? { ...bench, storageTier: 'hot', lastViewedAt: now } : bench
      );
      coldQueue = coldQueue.filter((queuedId) => queuedId !== id);
    }

    set({ benches: newBenches, coldQueue });
    saveBenches(newBenches);

    if (target?.storageTier === 'cold' && ratingChanged) {
      saveTierState({ version: TIER_VERSION, coldQueue });
      // 正在查看的这条不能被动，挪多出来的位置给下一条
      get().enforceCapacity(id);
    }
  },

  deleteBench: (id) => {
    const newBenches = get().benches.filter((bench) => bench.id !== id);
    const coldQueue = get().coldQueue.filter((queuedId) => queuedId !== id);
    set({ benches: newBenches, coldQueue });
    saveBenches(newBenches);
    saveTierState({ version: TIER_VERSION, coldQueue });
  },

  getBenchById: (id) => {
    return get().benches.find((bench) => bench.id === id);
  },

  addExperience: (benchId, experienceData) => {
    const newExperience: BenchExperience = {
      ...experienceData,
      id: generateId(),
      benchId,
    };
    const newBenches = get().benches.map((bench) =>
      bench.id === benchId
        ? {
            ...bench,
            experiences: [...bench.experiences, newExperience],
            updatedAt: new Date().toISOString(),
          }
        : bench
    );
    set({ benches: newBenches });
    saveBenches(newBenches);
  },

  updateExperience: (benchId, expId, updates) => {
    const newBenches = get().benches.map((bench) =>
      bench.id === benchId
        ? {
            ...bench,
            experiences: bench.experiences.map((exp) =>
              exp.id === expId ? { ...exp, ...updates } : exp
            ),
            updatedAt: new Date().toISOString(),
          }
        : bench
    );
    set({ benches: newBenches });
    saveBenches(newBenches);
  },

  deleteExperience: (benchId, expId) => {
    const newBenches = get().benches.map((bench) =>
      bench.id === benchId
        ? {
            ...bench,
            experiences: bench.experiences.filter((exp) => exp.id !== expId),
            updatedAt: new Date().toISOString(),
          }
        : bench
    );
    set({ benches: newBenches });
    saveBenches(newBenches);
  },

  getFilteredBenches: () => {
    const { benches, searchQuery, materialFilter, orientationFilter, shadeFilter, noiseFilter } = get();

    const query = searchQuery.toLowerCase();
    const hasSearch = query.length > 0;

    return benches.filter((bench) => {
      // 列表默认只算在库；冷存档案只有在搜索时才能被搜到
      if (bench.storageTier === 'cold' && !hasSearch) return false;

      if (hasSearch) {
        const matchName = bench.name.toLowerCase().includes(query);
        const matchLocation = bench.location.toLowerCase().includes(query);
        const matchReview = bench.review.toLowerCase().includes(query);
        if (!matchName && !matchLocation && !matchReview) return false;
      }

      if (materialFilter && bench.material !== materialFilter) return false;
      if (orientationFilter && bench.orientation !== orientationFilter) return false;
      if (shadeFilter && bench.shadeLevel !== shadeFilter) return false;
      if (noiseFilter && bench.noiseLevel !== noiseFilter) return false;

      return true;
    });
  },

  getHotBenches: () => get().benches.filter((bench) => bench.storageTier !== 'cold'),

  getColdBenches: () => get().benches.filter((bench) => bench.storageTier === 'cold'),

  recordBenchView: (id) => {
    const now = new Date().toISOString();
    const state = get();
    const bench = state.benches.find((b) => b.id === id);
    if (!bench) return;

    const wasCold = bench.storageTier === 'cold';
    const wasQueued = state.coldQueue.includes(id);

    // 更新最近查看时间；冷存档案被重新打开后回到在库
    const newBenches = state.benches.map((b) =>
      b.id === id
        ? { ...b, lastViewedAt: now, ...(wasCold ? { storageTier: 'hot' as const } : {}) }
        : b
    );
    let coldQueue = state.coldQueue;

    // 正在查看的这条不能被动：若它还在冷存迁移队列里，先移出队列
    if (wasQueued) {
      coldQueue = coldQueue.filter((queuedId) => queuedId !== id);
    }

    set({ benches: newBenches, coldQueue });
    saveBenches(newBenches);
    if (wasQueued) {
      saveTierState({ version: TIER_VERSION, coldQueue });
    }

    // 冷存档案回到在库后若超容量，把多出来的位置挪给下一条（正在查看的这条受保护）
    // 若查看的是已被排队、但还没挪走的在库档案，保下它后也要把超容量部分重新挪给下一条
    if (wasCold || wasQueued) {
      get().enforceCapacity(id);
    }
  },

  processColdQueue: async () => {
    if (get().coldMigration.active) return;

    set({
      coldMigration: { active: true, moved: 0, total: get().coldQueue.length },
    });

    while (true) {
      const { coldQueue } = get();
      if (coldQueue.length === 0) break;

      const batch = coldQueue.slice(0, COLD_BATCH_SIZE);
      const batchSet = new Set(batch);

      // 挪入冷存（幂等：已经在冷存的直接跳过）
      const newBenches = get().benches.map((bench) =>
        batchSet.has(bench.id) ? { ...bench, storageTier: 'cold' as const } : bench
      );
      const remainingQueue = coldQueue.filter((id) => !batchSet.has(id));

      const movedCount = get().coldMigration.moved + batch.length;

      set({
        benches: newBenches,
        coldQueue: remainingQueue,
        coldMigration: {
          active: true,
          moved: movedCount,
          total: movedCount + remainingQueue.length,
        },
      });
      saveBenches(newBenches);
      saveTierState({ version: TIER_VERSION, coldQueue: remainingQueue });

      await delay(COLD_BATCH_DELAY_MS);
    }

    set({ coldMigration: { active: false, moved: 0, total: 0 } });
    saveTierState({ version: TIER_VERSION, coldQueue: [] });
  },

  enforceCapacity: (protectId) => {
    const state = get();
    const evicted = pickEvictions(state.benches, protectId, state.coldQueue);
    if (evicted.length === 0) return;

    // 排队等后续再挪（不重复排队），迁移循环会接着处理
    const coldQueue = [...state.coldQueue, ...evicted];
    set({ coldQueue });
    saveTierState({ version: TIER_VERSION, coldQueue });
    get().processColdQueue();
  },
}));

export { HOT_CAPACITY };
