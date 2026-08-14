import { dlog, dwarn } from '@/utils/log';

// ─── SaveLoad ─────────────────────────────────────────────────────────────────
// Serialises and deserialises the full game state to/from JSON.
//
// **Slots, since M10.** There was one localStorage key, which was fine while the
// only affordance was a CONTINUE button on the menu and became the reason a Load
// screen would have had exactly one row. A slot is that same record under a
// numbered key, plus enough of a header — when, which game, how far in — to tell
// one from another without deserialising the board.
//
// The old single key is still read, once, and migrated into slot 1. A player who
// saved before this shipped keeps their game.

export interface SerializedGame {
  version: string;
  timestamp: number;
  seed: number;
  /** Which game was being played, for the slot list. Absent in pre-M10 saves. */
  gameId?: string;
  /** Round reached, for the slot list. Absent in pre-M10 saves. */
  round?: number;
  // Populated by GameScene.serialize() once game classes are complete
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: Record<string, any>;
}

/** What the Load screen shows for one slot. */
export interface SlotSummary {
  slot: number;
  used: boolean;
  timestamp: number;
  gameId: string;
  round: number;
}

const LEGACY_KEY = 'monopoly_forge_save';
const SLOT_KEY = (slot: number) => `monopoly_forge_save_${slot}`;
const VERSION = '0.1.0';

/** How many slots the menu offers. Three fits a screen and is enough to choose. */
export const SAVE_SLOTS = 3;

function readSlot(slot: number): SerializedGame | null {
  try {
    const raw = localStorage.getItem(SLOT_KEY(slot));
    if (!raw) return null;
    const data = JSON.parse(raw) as SerializedGame;
    if (data.version !== VERSION) {
      dwarn(`[SaveLoad] slot ${slot}: version mismatch — discarded.`);
      return null;
    }
    return data;
  } catch (e) {
    console.error(`[SaveLoad] slot ${slot}: failed to load:`, e);
    return null;
  }
}

/**
 * Move a pre-slot save into slot 1, once. Deliberately non-destructive of a slot
 * that already holds something: an old key is worth less than a game somebody
 * saved deliberately.
 */
function migrateLegacy(): void {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    if (!localStorage.getItem(SLOT_KEY(1))) {
      localStorage.setItem(SLOT_KEY(1), raw);
      dlog('[SaveLoad] migrated the old single save into slot 1.');
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // A browser with no storage is not a reason to fail to start.
  }
}

export const SaveLoad = {
  save(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: Record<string, any>, seed: number,
    slot = 1, meta: { gameId?: string; round?: number } = {},
  ): void {
    const data: SerializedGame = {
      version: VERSION,
      timestamp: Date.now(),
      seed,
      gameId: meta.gameId,
      round: meta.round,
      state,
    };
    try {
      localStorage.setItem(SLOT_KEY(slot), JSON.stringify(data));
      dlog(`[SaveLoad] saved to slot ${slot}.`);
    } catch (e) {
      console.error('[SaveLoad] Failed to save:', e);
    }
  },

  load(slot = 1): SerializedGame | null {
    migrateLegacy();
    return readSlot(slot);
  },

  /** Every slot, used or not, for the Load screen to draw a row per slot. */
  slots(): SlotSummary[] {
    migrateLegacy();
    return Array.from({ length: SAVE_SLOTS }, (_, i) => {
      const slot = i + 1;
      const data = readSlot(slot);
      return {
        slot,
        used: data !== null,
        timestamp: data?.timestamp ?? 0,
        gameId: data?.gameId ?? '',
        round: data?.round ?? 0,
      };
    });
  },

  /**
   * The most recently written slot, for a one-press CONTINUE. `>=` rather than
   * `>` so a tie goes to the later slot: `Date.now()` has millisecond
   * resolution, two saves can land inside one, and "whichever slot happens to be
   * lowest" is not what "most recent" means to anybody.
   */
  mostRecent(): SlotSummary | null {
    const used = this.slots().filter((s) => s.used);
    if (!used.length) return null;
    return used.reduce((best, s) => (s.timestamp >= best.timestamp ? s : best));
  },

  clear(slot = 1): void {
    localStorage.removeItem(SLOT_KEY(slot));
  },

  hasSave(slot = 1): boolean {
    migrateLegacy();
    return localStorage.getItem(SLOT_KEY(slot)) !== null;
  },
};
