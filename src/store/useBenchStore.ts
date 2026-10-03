import { create } from 'zustand';
import type { Bench, BenchExperience, MaterialType, OrientationType, ShadeLevelType, NoiseLevelType } from '@/types';
import { loadBenches, saveBenches, loadTierState, saveTierState } from '@/utils/storage';
import { generateId } from '@/utils/comfort';
import { mockBenches } from '@/data/mockBenches';
import {
  EMPTY_TIER_STATE,
  planTierMigration,
  moveToActive,
  pruneTierState,
} from '@/utils/tier';
import type { TierState } from '@/utils/tier';

interface BenchState {
  benches: Bench[];
  tier: TierState;
  searchQuery: string;
  materialFilter: MaterialType | null;
  orientationFilter: OrientationType | null;
  shadeFilter: ShadeLevelType | null;
  noiseFilter: NoiseLevelType | null;
  initialized: boolean;
}

interface BenchActions {
  initialize: (protectedId?: string | null) => void;
  setSearchQuery: (query: string) => void;
  setMaterialFilter: (material: MaterialType | null) => void;
  setOrientationFilter: (orientation: OrientationType | null) => void;
  setShadeFilter: (shade: ShadeLevelType | null) => void;
  setNoiseFilter: (noise: NoiseLevelType | null) => void;
  clearFilters: () => void;
  addBench: (bench: Omit<Bench, 'id' | 'createdAt' | 'updatedAt' | 'experiences' | 'lastViewedAt'>) => void;
  updateBench: (id: string, updates: Partial<Bench>) => void;
  deleteBench: (id: string) => void;
  touchBench: (id: string) => void;
  getBenchById: (id: string) => Bench | undefined;
  getActiveBenches: () => Bench[];
  isCold: (id: string) => boolean;
  addExperience: (benchId: string, experience: Omit<BenchExperience, 'id' | 'benchId'>) => void;
  updateExperience: (benchId: string, expId: string, updates: Partial<BenchExperience>) => void;
  deleteExperience: (benchId: string, expId: string) => void;
  getFilteredBenches: () => Bench[];
}

const initialState: BenchState = {
  benches: [],
  tier: { ...EMPTY_TIER_STATE },
  searchQuery: '',
  materialFilter: null,
  orientationFilter: null,
  shadeFilter: null,
  noiseFilter: null,
  initialized: false,
};

export const useBenchStore = create<BenchState & BenchActions>((set, get) => ({
  ...initialState,

  initialize: (protectedId = null) => {
    let stored = loadBenches();

    // 首次启动（无本地数据）：灌入种子数据
    if (stored.length === 0) {
      const now = new Date().toISOString();
      stored = mockBenches.map((bench) => ({
        ...bench,
        // 旧数据没有最近查看时间，升级时按创建时间补上
        lastViewedAt: bench.createdAt ?? now,
      }));
      saveBenches(stored);
    } else {
      // 兼容升级：给缺少 lastViewedAt 的旧档案按创建时间补上
      let migrated = false;
      stored = stored.map((bench) => {
        if (!bench.lastViewedAt) {
          migrated = true;
          return { ...bench, lastViewedAt: bench.createdAt };
        }
        return bench;
      });
      if (migrated) saveBenches(stored);
    }

    // 对账：清理分层里已不存在的 ID
    const validIds = new Set(stored.map((bench) => bench.id));
    let tier = pruneTierState(loadTierState(), validIds);

    // 首次分层，或接着上次没挪完的批次继续挪；正在查看的档案不能被动
    tier = planTierMigration(stored, tier, protectedId);
    saveTierState(tier);

    set({ benches: stored, tier, initialized: true });
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
      createdAt: now,
      updatedAt: now,
      lastViewedAt: now,
    };
    const benches = [newBench, ...get().benches];
    // 新档案在库；若挤爆容量，按优先级把最该冷存的排进队列并挪一批
    const tier = planTierMigration(benches, get().tier);
    set({ benches, tier });
    saveBenches(benches);
    saveTierState(tier);
  },

  updateBench: (id, updates) => {
    const wasCold = get().tier.coldIds.includes(id);
    const previous = get().benches.find((bench) => bench.id === id);
    const ratingChanged =
      updates.rating !== undefined && previous && updates.rating !== previous.rating;

    const benches = get().benches.map((bench) =>
      bench.id === id
        ? { ...bench, ...updates, updatedAt: new Date().toISOString() }
        : bench
    );

    // 改了评分的冷存档案回到在库；正在编辑的这条受保护，不能被挪走
    let tier = get().tier;
    let reopenedId: string | null = null;
    if (wasCold && ratingChanged) {
      tier = moveToActive(tier, id);
      reopenedId = id;
    }
    tier = planTierMigration(benches, tier, id, reopenedId);

    set({ benches, tier });
    saveBenches(benches);
    saveTierState(tier);
  },

  deleteBench: (id) => {
    const benches = get().benches.filter((bench) => bench.id !== id);
    const validIds = new Set(benches.map((bench) => bench.id));
    // 对账后重算：删掉在库档案空出位置时，排队者留库；删掉冷存档案不影响在库
    const tier = planTierMigration(benches, pruneTierState(get().tier, validIds));
    set({ benches, tier });
    saveBenches(benches);
    saveTierState(tier);
  },

  touchBench: (id) => {
    const bench = get().benches.find((item) => item.id === id);
    if (!bench) return;

    const leavingTier =
      get().tier.coldIds.includes(id) || get().tier.pendingIds.includes(id);
    const nowIso = new Date().toISOString();
    const benches = get().benches.map((item) =>
      item.id === id ? { ...item, lastViewedAt: nowIso } : item
    );

    // 冷存或排队中的档案被重新打开：回到在库，空出的位置顺延给下一条；
    // 正在查看的这条本身受保护不能被动
    let tier = get().tier;
    if (leavingTier) {
      tier = moveToActive(tier, id);
    }
    tier = planTierMigration(benches, tier, id, leavingTier ? id : null);

    set({ benches, tier });
    saveBenches(benches);
    saveTierState(tier);
  },

  getBenchById: (id) => {
    return get().benches.find((bench) => bench.id === id);
  },

  getActiveBenches: () => {
    const { benches, tier } = get();
    const cold = new Set(tier.coldIds);
    return benches.filter((bench) => !cold.has(bench.id));
  },

  isCold: (id) => get().tier.coldIds.includes(id),

  addExperience: (benchId, experienceData) => {
    const newExperience: BenchExperience = {
      ...experienceData,
      id: generateId(),
      benchId,
    };
    const benches = get().benches.map((bench) =>
      bench.id === benchId
        ? {
            ...bench,
            experiences: [...bench.experiences, newExperience],
            updatedAt: new Date().toISOString(),
          }
        : bench
    );
    set({ benches });
    saveBenches(benches);
  },

  updateExperience: (benchId, expId, updates) => {
    const benches = get().benches.map((bench) =>
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
    set({ benches });
    saveBenches(benches);
  },

  deleteExperience: (benchId, expId) => {
    const benches = get().benches.map((bench) =>
      bench.id === benchId
        ? {
            ...bench,
            experiences: bench.experiences.filter((exp) => exp.id !== expId),
            updatedAt: new Date().toISOString(),
          }
        : bench
    );
    set({ benches });
    saveBenches(benches);
  },

  getFilteredBenches: () => {
    const { benches, searchQuery, materialFilter, orientationFilter, shadeFilter, noiseFilter } = get();

    // 有关键词时在全部档案（含冷存）里搜索；无关键词时只看在库
    const scope = searchQuery.trim()
      ? benches
      : benches.filter((bench) => !get().tier.coldIds.includes(bench.id));

    return scope.filter((bench) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
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
}));
