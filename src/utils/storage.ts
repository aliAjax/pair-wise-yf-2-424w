import type { Bench } from '@/types';
import type { TierState } from '@/utils/tier';
import { createInitialTierState } from '@/utils/tier';

const STORAGE_KEY = 'bench-archive-data';
const TIER_STATE_KEY = 'bench-archive-tier-state';

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
    const data = localStorage.getItem(TIER_STATE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.coldQueue)) {
        return {
          version: typeof parsed.version === 'number' ? parsed.version : 0,
          coldQueue: parsed.coldQueue.filter((id: unknown) => typeof id === 'string'),
        };
      }
    }
  } catch (error) {
    console.error('Failed to load tier state from localStorage:', error);
  }
  return createInitialTierState();
}

export function saveTierState(state: TierState): void {
  try {
    localStorage.setItem(TIER_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save tier state to localStorage:', error);
  }
}

export function clearTierState(): void {
  try {
    localStorage.removeItem(TIER_STATE_KEY);
  } catch (error) {
    console.error('Failed to clear tier state from localStorage:', error);
  }
}
