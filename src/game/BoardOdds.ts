import type { Board } from './Board';

// ─── BoardOdds ────────────────────────────────────────────────────────────────
// How often each square gets landed on, in the long run.
//
// This is the number the baseline bot has never had. Every decision it makes is
// priced off the *printed* price — buy it if you can afford it, bid a fraction
// over, build on the cheapest lot — and the printed price says nothing about how
// often anybody stops there. That is why tuning its three constants changed
// nothing measurable in 8d: they were all answers to the wrong question.
//
// It is computed rather than tabulated, which matters more here than it would in
// a game with one board. The famous facts about Monopoly — that Jail is the most
// visited square and the oranges are the best buy — are *consequences* of Go To
// Jail sitting six to eight from them, and a table of them would be a table
// about the 1935 board. Running the chain instead gives the same answer for the
// classic board and a correct one for a circle, a spiral, or 120 tiles across
// three loops.
//
// **What it models, and what it does not.** Two dice and the Go To Jail square;
// that is all. Cards that move you (about ten of the thirty-two) and the
// three-doubles rule are left out, and both would sharpen the peak around Jail
// rather than move it. The approximation is deliberate: the pattern the bot
// needs is *which squares are busy*, and that is decided by Go To Jail. Adding
// the deck would mean the odds depending on which cards remain, and a valuation
// that changed every time somebody drew one is worse than a stable one that is
// slightly blunt.

/** 2d6, as counts out of 36, indexed by total. */
const TWO_DICE: ReadonlyArray<[steps: number, ways: number]> = [
  [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6],
  [8, 5], [9, 4], [10, 3], [11, 2], [12, 1],
];

const WAYS = 36;
/** Enough for the chain to settle; the classic board is within 1e-6 by ~120. */
const ITERATIONS = 400;

/**
 * Cached per board object. A board is built once per game and the chain costs a
 * few hundred small loops, so this is measured once and read thousands of times —
 * `Bot` asks for it on every valuation.
 */
const cache = new WeakMap<Board, number[]>();

/**
 * The share of landings each tile takes, summing to 1.
 *
 * Deterministic, and drawing nothing from `rng` — a bot that moved the dice
 * stream would stop a seeded game replaying, which is the rule every decision in
 * `Bot.ts` is written to.
 */
export function landingOdds(board: Board): number[] {
  const cached = cache.get(board);
  if (cached) return cached;

  const size = board.size;
  const jail = board.tryAnchor('jail');

  // Where a roll of `steps` from `from` actually lands, Go To Jail included.
  const destination = (from: number, steps: number): number => {
    const to = board.move(from, steps, { crossing: steps % 2 === 0 }).to;
    return board.getTile(to).type === 'goToJail' && jail !== null ? jail : to;
  };

  // Precomputed once: the chain below walks it four hundred times.
  const moves: Array<Array<[to: number, weight: number]>> = [];
  for (let from = 0; from < size; from++) {
    const row: Array<[number, number]> = [];
    for (const [steps, ways] of TWO_DICE) row.push([destination(from, steps), ways / WAYS]);
    moves.push(row);
  }

  let odds = new Array<number>(size).fill(1 / size);
  for (let step = 0; step < ITERATIONS; step++) {
    const next = new Array<number>(size).fill(0);
    for (let from = 0; from < size; from++) {
      const share = odds[from];
      if (share === 0) continue;
      for (const [to, weight] of moves[from]) next[to] += share * weight;
    }
    odds = next;
  }

  cache.set(board, odds);
  return odds;
}

/**
 * How busy a tile is relative to an evenly-walked board. 1 is average, and the
 * classic Jail comes out near 3.
 *
 * A ratio rather than the raw share, so a valuation written against it reads the
 * same on a 24-tile board and a 120-tile one.
 */
export function trafficOf(board: Board, tileId: number): number {
  return landingOdds(board)[tileId] * board.size;
}
