import { TILE_TYPES } from '@/tiles/registry';
import { CARD_EFFECTS } from '@/cards/effects';
import { TURN_ORDERS, WIN_CONDITIONS } from '@/game/TurnFlow';
import { VARIANTS } from '@/game/Variants';
import { MOVEMENTS } from '@/game/Movement';
import { TILE_EFFECTS } from '@/game/TileEffects';
import { dlog } from '@/utils/log';
import type { Game } from './Game';

// ─── Scope ────────────────────────────────────────────────────────────────────
// Which game's registrations are in force.
//
// Every registry in the engine is a module-level singleton, which is exactly
// right for a browser tab playing one game and exactly wrong for a batch runner
// loading three. Two games that each register a `tollBooth`, or each replace
// `collectFromBank`, would silently get each other's — and a simulation that
// answers *wrongly* is worse than one that fails.
//
// `loadGame` is the fix, and it is deliberately the simplest one that works:
// put every registry back to the built-ins, then apply this game's own. What
// that buys is **serial isolation** — only one game is ever live, so no two can
// leak into each other. It is not concurrent isolation, and nothing here lets
// two games be loaded at the same instant. A batch runs one game at a time,
// which is what a batch is; if that ever stops being true, the registries have
// to become instances rather than singletons, and this is the seam where that
// change would go.

const REGISTRIES = [TILE_TYPES, CARD_EFFECTS, TURN_ORDERS, WIN_CONDITIONS, VARIANTS, MOVEMENTS, TILE_EFFECTS];

type Baseline = Array<Map<string, unknown>>;

/**
 * The built-ins, captured the first time a game is loaded rather than at import
 * time: the modules above register themselves as they are evaluated, and taking
 * the snapshot lazily means it cannot race that. The imports at the top of this
 * file are what guarantee they have all been evaluated by then.
 */
let builtIns: Baseline | null = null;

/** Which game is in force, or null before the first `loadGame`. */
let current: Game | null = null;

export function loadedGame(): Game | null {
  return current;
}

/**
 * Make this game's registrations the ones in force. Idempotent: loading the same
 * game twice is a reset and a re-register, not a doubling.
 */
export function loadGame(game: Game): Game {
  builtIns ??= REGISTRIES.map((r) => r.capture() as Map<string, unknown>);

  REGISTRIES.forEach((registry, i) => {
    (registry as { restore(s: Map<string, unknown>): void }).restore(builtIns![i]);
  });

  current = game;
  game.register?.();
  dlog(`[games] loaded "${game.id}" — ${TILE_TYPES.names().length} tile types in force`);
  return game;
}

/**
 * Put the built-ins back and forget the current game. For a test that registered
 * something, and for a runner between batches.
 */
export function unloadGame(): void {
  if (!builtIns) return;
  REGISTRIES.forEach((registry, i) => {
    (registry as { restore(s: Map<string, unknown>): void }).restore(builtIns![i]);
  });
  current = null;
}
