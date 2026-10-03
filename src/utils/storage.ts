import type { Bench } from '@/types';
import { EMPTY_TIER_STATE } from '@/utils/tier';
import type { TierState } from '@/utils/tier';

const STORAGE_KEY = 'bench-archive-data';
const TIER_STORAGE_KEY = 'bench-archive-tier-v1';

export function loadBenches(): Bench[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load benches from localStorage:', error);
  }
  return [];
}

export function saveBenches(benches: Bench[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(benches));
  } catch (error) {
    console.error('Failed to save benches to localStorage:', error);
  }
}

export function clearBenches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear benches from localStorage:', error);
  }
}

export function loadTierState(): TierState {
  try {
    const data = localStorage.getItem(TIER_STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data) as Partial<TierState>;
      return {
        coldIds: Array.isArray(parsed.coldIds) ? parsed.coldIds : [],
        pendingIds: Array.isArray(parsed.pendingIds) ? parsed.pendingIds : [],
        initialized: parsed.initialized === true,
      };
    }
  } catch (error) {
    console.error('Failed to load tier state from localStorage:', error);
  }
  return { ...EMPTY_TIER_STATE };
}

export function saveTierState(state: TierState): void {
  try {
    localStorage.setItem(TIER_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save tier state to localStorage:', error);
  }
}
