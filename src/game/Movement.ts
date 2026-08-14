import { Registry } from '@/utils/Registry';
import type { Board } from './Board';

// ─── Movement ─────────────────────────────────────────────────────────────────
// What "one step forward" means.
//
// It was `(from + 1) % size` inline in `Board.move` until M11, which is the right
// answer for every board that is one loop — and every board that shipped was.
// Ultimate Monopoly is not: three loops joined at four junctions, where an even
// roll carries you across and an odd one does not. That cannot be expressed as a
// modulus, and a board that *looks* like three rings while being one circuit is
// the thing `BoardLayout` has always warned about — `rings` is an arrangement,
// not a topology.
//
// So the step became a strategy, named by string in the rule set for the same
// reason `turnOrder` and `winCondition` are: a rule set is saved with the game,
// and `'tracks'` survives `JSON.stringify` where a function does not.
//
// Two things follow from making it a *step* rather than a *jump*, and both are
// the reason it is worth doing this way:
//
//   * **`move` walks, so it can report the route.** `{ to, path }` — the tokens
//     follow the path rather than recomputing it, which is the only way an
//     animation can show a player crossing tracks.
//   * **Distance stops being arithmetic.** "How far to tile 84" is a search on a
//     graph now, not a subtraction, which is why `pathTo` and `scan` live on
//     `Board` and everything that used to count with `stepsBetween` asks them.

/** What a strategy is told about the move it is stepping through. */
export interface StepContext {
  /** -1 while a "go back three spaces" walks backwards. */
  direction: 1 | -1;
  /**
   * Whether this move may change track at a junction. Ultimate Monopoly's rule
   * is the parity of the roll — even crosses, odd stays — so the driver passes
   * the parity in and the strategy decides what to do with it. A card's direct
   * move sets it too, because a card that names a tile on another track has to
   * be able to get there.
   */
  crossing: boolean;
}

export interface MovementStrategy {
  /** The tile one step on from `from`. Must always return a tile on the board. */
  next(board: Board, from: number, ctx: StepContext): number;
}

export type BuiltInMovement = 'circuit' | 'tracks';

export const MOVEMENTS = new Registry<MovementStrategy>('movements');

export function registerMovement(name: string, strategy: MovementStrategy): void {
  MOVEMENTS.set(name, strategy);
}

export function knownMovements(): string[] {
  return MOVEMENTS.names();
}

/** Unknown means a board nobody can move on, so this throws rather than guessing. */
export function movementNamed(name: string): MovementStrategy {
  return MOVEMENTS.require(name);
}

// ─── The circuit ──────────────────────────────────────────────────────────────

/**
 * One loop, the way every board did it before this file existed. Positive
 * modulo because JS `%` keeps the sign and `tiles[-1]` is `undefined` — the
 * three-places-sanitised rule in CLAUDE.md, and this is one of the three.
 */
registerMovement('circuit', {
  next(board, from, ctx) {
    return ((from + ctx.direction) % board.size + board.size) % board.size;
  },
});

// ─── Tracks ───────────────────────────────────────────────────────────────────

/** A loop within the tile list: `count` tiles starting at `from`. */
export interface TrackSpec {
  id: string;
  from: number;
  count: number;
}

/**
 * Two tiles that are "considered one space" — a railroad on one track and a
 * transit station on the next one out. Stepping *off* either of them with
 * `crossing` set continues from the other, which is precisely how the printed
 * rule reads: an even roll that takes you *past* a transit station rides it to
 * the opposite track.
 */
export interface JunctionSpec {
  a: number;
  b: number;
}

registerMovement('tracks', {
  next(board, from, ctx) {
    // Cross first, step second. A junction is one space, so the step that leaves
    // it may leave from either half — and which half decides which loop you are
    // on for every step after this one.
    const partner = ctx.crossing ? board.junctionPartner(from) : null;
    const at      = partner ?? from;
    const track   = board.trackOf(at);
    const offset  = at - track.from;
    return track.from + ((offset + ctx.direction) % track.count + track.count) % track.count;
  },
});
