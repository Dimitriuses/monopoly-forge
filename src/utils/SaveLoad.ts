import { dlog, dwarn } from '@/utils/log';

// ─── SaveLoad ─────────────────────────────────────────────────────────────────
// Serialises and deserialises the full game state to/from JSON.
// The GameScene calls these when the player uses the save/load UI.

export interface SerializedGame {
  version: string;
  timestamp: number;
  seed: number;
  // Populated by GameScene.serialize() once game classes are complete
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: Record<string, any>;
}

const SAVE_KEY = 'monopoly_forge_save';
const VERSION = '0.1.0';

export const SaveLoad = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  save(state: Record<string, any>, seed: number): void {
    const data: SerializedGame = {
      version: VERSION,
      timestamp: Date.now(),
      seed,
      state,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      dlog('[SaveLoad] Game saved.');
    } catch (e) {
      console.error('[SaveLoad] Failed to save:', e);
    }
  },

  load(): SerializedGame | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SerializedGame;
      if (data.version !== VERSION) {
        dwarn('[SaveLoad] Version mismatch — save data discarded.');
        return null;
      }
      return data;
    } catch (e) {
      console.error('[SaveLoad] Failed to load:', e);
      return null;
    }
  },

  clear(): void {
    localStorage.removeItem(SAVE_KEY);
  },

  hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null;
  },
};
