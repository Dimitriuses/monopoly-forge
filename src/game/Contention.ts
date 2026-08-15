import { PropertyTile } from '@/tiles/PropertyTile';
import { canBuild } from './BuildRules';
import type { Board } from './Board';
import type { Bank } from './Bank';
import type { Player } from './Player';

// ─── Contention ───────────────────────────────────────────────────────────────
// "If two or more players wish to buy more houses than the Bank has, the houses
// must be sold at auction to the highest bidder."
//
// The rule was left out of this game for four milestones with a good reason: a
// turn-based click UI never produces *simultaneous* demand. Players ask one at a
// time and turn order settles it, which is what KNOWNISSUES has said all along.
//
// What makes it expressible is deciding what "wishes to buy" means without a
// prompt. It is answered here as **could and can afford to**: a player who owns
// a lot the build rules would allow a house on, and holds the cash for it, is
// bidding whether they clicked anything or not. That is a decision, not a fact,
// and it is written down rather than buried in a scene:
//
//   * it needs no new prompt, and no answer from a bot that `Bot.ts` cannot give;
//   * it is a pure function of the board, so it is unit-testable and the
//     simulator gets the rule for free;
//   * it is *generous* — somebody who was not going to build still counts as a
//     claimant — which matters only when the bank is down to its last houses,
//     which is exactly when the rule is meant to bite.
//
// Nothing here decides *who* wins: that is `Auction`, over a subject of kind
// `'house'`, which is why the auction had to stop being about a tile id first.

export interface HouseClaim {
  player: Player;
  /** Lots this player could legally put a house on right now, cheapest first. */
  lots: PropertyTile[];
  /** What the cheapest of those would cost. */
  cheapest: number;
}

/** Everyone who could take a house from the bank this moment. */
export function houseClaims(board: Board, bank: Bank, players: Player[]): HouseClaim[] {
  const claims: HouseClaim[] = [];

  for (const player of players) {
    if (player.isBankrupt) continue;

    const lots = [...player.ownedTileIds]
      .map((id) => board.getTile(id))
      .filter((t): t is PropertyTile => t instanceof PropertyTile)
      // `canBuildHouse` already asks the bank whether it has any left, so a
      // claim is only ever raised while there is something to contend for.
      .filter((lot) => canBuild(board, bank, player, lot).ok)
      .filter((lot) => player.canAfford(lot.houseCost))
      .sort((a, b) => a.houseCost - b.houseCost || a.id - b.id);

    if (lots.length) claims.push({ player, lots, cheapest: lots[0].houseCost });
  }
  return claims;
}

/**
 * Whether the next house has to be auctioned rather than sold. The rule's own
 * wording, exactly: *two or more* players want one, and the bank holds fewer
 * than they collectively want. With 32 houses in stock that is never true, which
 * is the point — it only fires when the supply is genuinely short.
 */
export function housesContested(board: Board, bank: Bank, players: Player[]): boolean {
  const claims = houseClaims(board, bank, players);
  return claims.length >= 2 && bank.houses < claims.length;
}

/**
 * What the winner builds on. Whoever asked for the house in the first place gets
 * the lot they asked for; anybody else gets the cheapest lot they could legally
 * build on.
 *
 * The official rule lets the winner nominate, and a hot-seat game could ask
 * them — but only with a prompt, which a bot then also owes an answer to. This
 * is the deterministic reading, and the deviation is recorded in KNOWNISSUES
 * rather than left for somebody to discover.
 */
export function nominateLot(
  claims: HouseClaim[], winner: Player, requested: PropertyTile | null,
): PropertyTile | null {
  const claim = claims.find((c) => c.player.id === winner.id);
  if (!claim) return null;
  if (requested && claim.lots.some((lot) => lot.id === requested.id)) return requested;
  return claim.lots[0] ?? null;
}

/** The least the bank will take for a contested house: what it is worth to the
 *  cheapest claimant. Below that, scarcity would make houses cheaper. */
export function houseReserve(claims: HouseClaim[]): number {
  return claims.reduce((low, claim) => Math.min(low, claim.cheapest), Infinity);
}
