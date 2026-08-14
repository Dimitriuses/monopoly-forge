import type { SimResult } from './Runner';

// ─── Report ───────────────────────────────────────────────────────────────────
// What a batch of games says, in the numbers a balance pass actually uses.
//
// Kept out of the CLI so a test can assert on a summary without parsing printed
// text, and so a future runner — a web page, a CI job — can produce the same
// figures without copying the arithmetic.
//
// Medians rather than means, deliberately: game length has a long tail (one
// stalemate drags a mean anywhere) and "half of games are shorter than this" is
// the sentence a balance pass wants.

export interface Summary {
  gameId: string;
  runs: number;
  /** Games that hit the turn cap without a winner. */
  unfinished: number;
  /** Which seeds those were, so one can be replayed and looked at. */
  unfinishedSeeds: number[];
  turns: { median: number; p10: number; p90: number; max: number };
  rounds: { median: number };
  /** Share of games in which the bank ran out of houses at some point. */
  houseShortage: number;
  /** Mean houses and hotels standing when a game ended. */
  built: { houses: number; hotels: number };
  auctions: { median: number };
  trades: { median: number };
  /** How often each seat won, by index. A fair game is roughly even. */
  winsBySeat: number[];
  /** Games where the first seat's advantage shows: seat 1 wins this often. */
  firstSeatEdge: number;
  millis: number;
}

export function summarise(gameId: string, results: SimResult[], millis: number): Summary {
  const finished = results.filter((r) => r.finished);
  const turns = finished.map((r) => r.turns).sort((a, b) => a - b);
  const seatCount = Object.keys(results[0]?.cash ?? {}).length;

  const wins = new Array<number>(seatCount).fill(0);
  for (const result of finished) {
    if (!result.winnerId) continue;
    const seat = Number(result.winnerId.replace('p', '')) - 1;
    if (seat >= 0 && seat < seatCount) wins[seat]++;
  }

  return {
    gameId,
    runs: results.length,
    unfinished: results.length - finished.length,
    unfinishedSeeds: results.filter((r) => !r.finished).map((r) => r.seed),
    turns: {
      median: quantile(turns, 0.5),
      p10:    quantile(turns, 0.1),
      p90:    quantile(turns, 0.9),
      max:    turns.length ? turns[turns.length - 1] : 0,
    },
    rounds: { median: quantile(finished.map((r) => r.rounds).sort((a, b) => a - b), 0.5) },
    houseShortage: share(results, (r) => r.houseShortage),
    built: {
      houses: mean(results.map((r) => r.housesBuilt)),
      hotels: mean(results.map((r) => r.hotelsBuilt)),
    },
    auctions: { median: quantile(results.map((r) => r.auctions).sort((a, b) => a - b), 0.5) },
    trades:   { median: quantile(results.map((r) => r.trades).sort((a, b) => a - b), 0.5) },
    winsBySeat: wins,
    firstSeatEdge: finished.length ? wins[0] / finished.length : 0,
    millis,
  };
}

// ─── Printing ─────────────────────────────────────────────────────────────────

export function formatSummary(
  summaries: Summary[], header: { runs: number; seed: number; seats: string },
): string {
  const lines: string[] = [
    '',
    `▶ ${header.runs} games each, seeds ${header.seed}–${header.seed + header.runs - 1}, ${header.seats}`,
    '',
  ];

  for (const s of summaries) {
    lines.push(`  ${s.gameId}`);
    lines.push(`    turns          median ${s.turns.median}  ·  p10 ${s.turns.p10}  ·  p90 ${s.turns.p90}  ·  longest ${s.turns.max}`);
    lines.push(`    rounds         median ${s.rounds.median}`);
    lines.push(`    unfinished     ${s.unfinished}${
      s.unfinished ? `  (seeds ${s.unfinishedSeeds.slice(0, 8).join(', ')})` : ''}`);
    lines.push(`    house shortage ${percent(s.houseShortage)} of games`);
    lines.push(`    built at end   ${s.built.houses.toFixed(1)} houses, ${s.built.hotels.toFixed(1)} hotels`);
    lines.push(`    auctions       median ${s.auctions.median}   trades  median ${s.trades.median}`);
    lines.push(`    wins by seat   ${s.winsBySeat.join(' / ')}   (seat 1: ${percent(s.firstSeatEdge)})`);
    lines.push(`    took           ${(s.millis / 1000).toFixed(1)}s`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Arithmetic ───────────────────────────────────────────────────────────────

/** `sorted` must already be ascending. Nearest-rank, which needs no interpolation. */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function share<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.length ? items.filter(predicate).length / items.length : 0;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}
