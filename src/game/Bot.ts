import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import {
  canBuildHouse, canBuildHotel, canUnmortgage, ownsWholeGroup, unmortgageCost,
} from './BuildRules';
import { countOwnedOfType } from './Rent';
import type { Board } from './Board';
import type { Bank } from './Bank';
import type { Player } from './Player';
import type { TradeOffer } from './Trade';

// ─── Bot ──────────────────────────────────────────────────────────────────────
// The decision layer. It answers questions — buy this? bid how much? build
// where? — and returns decisions; it never touches a scene, a button or a tween.
// Whoever is driving applies them: `GameScene` today, a headless runner in M8d.
//
// Everything here is a pure function of the state passed in. No randomness, for
// two reasons: a bot that drew from the shared PRNG would shift the dice stream
// and break seeded reproducibility, and a deterministic policy is one you can
// actually debug when a simulated game goes wrong.
//
// The policy is deliberately simple and readable rather than strong. It is a
// baseline: something to play against, and something for M8d to measure a better
// one against.

export interface BotProfile {
  /** Cash the bot tries not to spend below. Keeps it from mortgaging itself flat. */
  reserve: number;
  /** Fraction of face value it will pay for a deed at auction, at most. */
  auctionCeiling: number;
  /** Only build once holding at least this much beyond the reserve. */
  buildBuffer: number;
}

export const DEFAULT_PROFILE: BotProfile = {
  reserve: 150,
  auctionCeiling: 1.2,
  buildBuffer: 100,
};

/** Everything a decision can depend on. Read-only by convention. */
export interface BotContext {
  board: Board;
  bank: Bank;
  player: Player;
  players: Player[];
  profile?: BotProfile;
}

const profileOf = (ctx: BotContext): BotProfile => ctx.profile ?? DEFAULT_PROFILE;

// ─── Buying ───────────────────────────────────────────────────────────────────

/**
 * Buy at the asking price? Yes when it leaves the reserve intact, and always for
 * a deed that completes a colour group or adds to a railroad holding — those are
 * worth more than the sticker price says.
 */
export function shouldBuy(ctx: BotContext, tile: Tile & Ownable): boolean {
  const { player } = ctx;
  const price = tile.price;
  if (!player.canAfford(price)) return false;

  if (isStrategic(ctx, tile)) return player.cash - price >= 0;
  return player.cash - price >= profileOf(ctx).reserve;
}

/**
 * The most this bot will bid for a deed. Returns 0 when it should pass.
 * A deed that completes a group is worth paying over the odds for; anything else
 * is capped at a fraction of face value and never dips into the reserve.
 */
export function auctionCeiling(ctx: BotContext, tile: Tile & Ownable): number {
  const { player } = ctx;
  const profile = profileOf(ctx);
  const strategic = isStrategic(ctx, tile);

  const ceiling = Math.floor(tile.price * (strategic ? profile.auctionCeiling + 0.5 : profile.auctionCeiling));
  const spendable = strategic ? player.cash : player.cash - profile.reserve;
  return Math.max(0, Math.min(ceiling, spendable));
}

/**
 * The bid to make now, or null to pass.
 *
 * The raise is a real step — a tenth of the deed's face value — rather than the
 * table minimum. Matching the minimum turns a $300 deed into a thirty-round
 * crawl at $10 a time: slow to watch, and slower still when M8d runs a thousand
 * games of it. Stepping converges in a handful of rounds and still lets the
 * bidder with the highest ceiling win.
 */
export function nextBid(
  ctx: BotContext, tile: Tile & Ownable, currentBid: number, minimumBid: number,
): number | null {
  const ceiling = auctionCeiling(ctx, tile);
  if (minimumBid > ceiling) return null;

  const step = Math.max(minimumBid, currentBid + Math.ceil(tile.price / 10));
  return Math.min(step, ceiling);
}

// ─── Jail ─────────────────────────────────────────────────────────────────────

export type JailChoice = 'card' | 'pay' | 'roll';

/**
 * Early on, a jail cell is cheap rent protection, so the bot sits it out; once the
 * board is developed, being stuck is the expensive option and it buys its way out.
 */
export function jailChoice(ctx: BotContext, fine: number): JailChoice {
  const { player } = ctx;
  if (player.getOutOfJailCards > 0) return 'card';

  const developed = ctx.board.tiles.some(
    (t) => t instanceof PropertyTile && (t.houses > 0 || t.hasHotel),
  );
  if (developed && player.cash >= fine + profileOf(ctx).reserve) return 'pay';
  return 'roll';
}

// ─── Development ──────────────────────────────────────────────────────────────

export interface BuildStep {
  tileId: number;
  kind: 'house' | 'hotel';
}

/**
 * What to build right now, cheapest lot first so a group comes up evenly. Returns
 * the whole plan; the driver applies the steps one at a time, re-planning as cash
 * and bank stock change under it.
 */
export function buildPlan(ctx: BotContext): BuildStep[] {
  const { board, bank, player } = ctx;
  const profile = profileOf(ctx);
  const budget = player.cash - profile.reserve - profile.buildBuffer;
  if (budget <= 0) return [];

  const steps: BuildStep[] = [];
  let spent = 0;

  const lots = [...player.ownedTileIds]
    .map((id) => board.getTile(id))
    .filter((t): t is PropertyTile => t instanceof PropertyTile)
    .sort((a, b) => a.houseCost - b.houseCost);

  for (const lot of lots) {
    if (canBuildHouse(board, bank, player, lot).ok && spent + lot.houseCost <= budget) {
      steps.push({ tileId: lot.id, kind: 'house' });
      spent += lot.houseCost;
    } else if (canBuildHotel(board, bank, player, lot).ok && spent + lot.houseCost <= budget) {
      steps.push({ tileId: lot.id, kind: 'hotel' });
      spent += lot.houseCost;
    }
  }
  return steps;
}

/** Deeds worth un-mortgaging with spare cash, most valuable first. */
export function redeemPlan(ctx: BotContext): number[] {
  const { board, player } = ctx;
  const profile = profileOf(ctx);

  return [...player.ownedTileIds]
    .map((id) => board.getTile(id))
    .filter((t): t is Tile & Ownable => isOwnable(t) && t.isMortgaged)
    .filter((t) => canUnmortgage(player, t).ok
                && player.cash - unmortgageCost(t) >= profile.reserve + profile.buildBuffer)
    .sort((a, b) => b.mortgage - a.mortgage)
    .map((t) => t.id);
}

// ─── Trading ──────────────────────────────────────────────────────────────────

/**
 * Accept an offer? Only on a straight valuation: what the bot receives has to beat
 * what it gives up, and it will not hand over a deed that completes somebody
 * else's colour group at any price.
 */
export function acceptTrade(ctx: BotContext, offer: TradeOffer): boolean {
  const { board, player } = ctx;
  const iAmProposer = offer.fromId === player.id;
  const giving = iAmProposer ? offer.fromTileIds : offer.toTileIds;
  const getting = iAmProposer ? offer.toTileIds : offer.fromTileIds;
  const givingCash = iAmProposer ? offer.fromCash : offer.toCash;
  const gettingCash = iAmProposer ? offer.toCash : offer.fromCash;

  if (!player.canAfford(givingCash)) return false;

  const other = ctx.players.find((p) => p.id === (iAmProposer ? offer.toId : offer.fromId));
  if (other && giving.some((id) => completesGroupFor(board, other, id))) return false;

  const given = giving.reduce((sum, id) => sum + valueOf(ctx, id), givingCash);
  const gained = getting.reduce((sum, id) => sum + valueOf(ctx, id), gettingCash);
  return gained > given;
}

// ─── Valuation ────────────────────────────────────────────────────────────────

/** What a deed is worth to *this* bot, over and above its price. */
function valueOf(ctx: BotContext, tileId: number): number {
  const tile = ctx.board.getTile(tileId);
  if (!isOwnable(tile)) return 0;
  return isStrategic(ctx, tile) ? Math.floor(tile.price * 1.5) : tile.price;
}

/** A deed that completes a colour group, or a fourth railroad, and so on. */
function isStrategic(ctx: BotContext, tile: Tile & Ownable): boolean {
  const { board, player } = ctx;

  if (tile instanceof PropertyTile) {
    if (ownsWholeGroup(board, player, tile)) return true;
    // How big a group is comes from the map, not from a table of the classic
    // board's group sizes — this bot plays whatever board it is given.
    const group = board.groupTiles(tile.group);
    const owned = group.filter((t) => t.ownerId === player.id).length;
    return owned + 1 >= group.length;
  }
  if (tile.type === 'railroad') return countOwnedOfType(board, player, 'railroad') >= 1;
  if (tile.type === 'utility')  return countOwnedOfType(board, player, 'utility') >= 1;
  return false;
}

/** Would handing this deed over complete a group for `other`? */
function completesGroupFor(board: Board, other: Player, tileId: number): boolean {
  const tile = board.getTile(tileId);
  if (!(tile instanceof PropertyTile)) return false;
  const group = board.groupTiles(tile.group);
  return group.every((t) => t.id === tile.id || t.ownerId === other.id);
}
