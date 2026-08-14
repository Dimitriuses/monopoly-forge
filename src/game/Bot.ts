import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import {
  canBuildHouse, canBuildHotel, canUnmortgage, ownsWholeGroup, unmortgageCost,
} from './BuildRules';
import { countOwnedOfType } from './Rent';
import type { Board } from './Board';
import type { Bank } from './Bank';
import type { Player } from './Player';
import { emptyOffer, validateTrade, type TradeOffer } from './Trade';

// ─── Bot ──────────────────────────────────────────────────────────────────────
// The decision layer. It answers questions — buy this? bid how much? build
// where? — and returns decisions; it never touches a scene, a button or a tween.
// Whoever is driving applies them — `GameScene` in a browser, `sim/Runner.ts` in
// a batch of a thousand games.
//
// Everything here is a pure function of the state passed in. No randomness, for
// two reasons: a bot that drew from the shared PRNG would shift the dice stream
// and break seeded reproducibility, and a deterministic policy is one you can
// actually debug when a simulated game goes wrong.
//
// The policy is deliberately simple and readable rather than strong. It is a
// baseline — and since M8d it is a *measured* one: tuning its three constants
// changes nothing (see `AGGRESSIVE_PROFILE`), while seat order is worth 60/40 to
// the first two seats. A better bot has to be a different shape, not different
// numbers.

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

/**
 * A second policy, so the first one can be *measured* rather than asserted to be
 * reasonable. It is the same decisions with different numbers — it keeps almost
 * no cash back, pays well over the odds at auction, and starts building the
 * moment it can — which is exactly the axis worth testing first: the baseline's
 * three constants were picked by feel in M7 and have never been checked against
 * anything.
 *
 * A genuinely different *shape* of policy (counting the rent it is likely to
 * face, weighing position, planning more than one purchase ahead) is a bigger
 * question, and one this simulator now makes answerable.
 */
export const AGGRESSIVE_PROFILE: BotProfile = {
  reserve: 40,
  auctionCeiling: 1.6,
  buildBuffer: 0,
};

export const PROFILES: Record<string, BotProfile> = {
  baseline:   DEFAULT_PROFILE,
  aggressive: AGGRESSIVE_PROFILE,
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
 * crawl at $10 a time: slow to watch, and slower still when the simulator runs a
 * thousand games of it. Stepping converges in a handful of rounds and still lets the
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

/**
 * The most this bot will pay for a house the bank is short of, and the bid to
 * make now. Scarcity is worth paying over the odds for — half as much again as
 * the printed cost — but never out of the reserve: a house is not worth being
 * unable to pay rent for.
 */
export function houseCeiling(ctx: BotContext, houseCost: number): number {
  const profile = profileOf(ctx);
  return Math.max(0, Math.min(
    Math.floor(houseCost * 1.5),
    ctx.player.cash - profile.reserve,
  ));
}

export function nextHouseBid(
  ctx: BotContext, houseCost: number, currentBid: number, minimumBid: number,
): number | null {
  const ceiling = houseCeiling(ctx, houseCost);
  if (minimumBid > ceiling) return null;
  const step = Math.max(minimumBid, currentBid + Math.ceil(houseCost / 10));
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
                && player.cash - unmortgageCost(t, ctx.board.rules.mortgageInterest)
                   >= profile.reserve + profile.buildBuffer)
    .sort((a, b) => b.mortgage - a.mortgage)
    .map((t) => t.id);
}

// ─── Trading ──────────────────────────────────────────────────────────────────

/**
 * Accept an offer? Only on a straight valuation: what the bot receives has to
 * beat what it gives up.
 *
 * The one deed it holds back is the one that would complete somebody else's
 * colour group — **unless they are handing over the one that completes ours**.
 * That exception is what makes a bot able to trade with a bot at all: an
 * absolute veto meant the only deed worth asking for was the only deed nobody
 * would ever part with, so two bots one lot short of two different groups sat
 * across the table from each other for the whole game. Two monopolies made at
 * once is the trade real players make, and cash alone still will not buy it.
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
  const givingTheirKey = !!other && giving.some((id) => completesGroupFor(board, other, id));
  const gettingOurKey  = getting.some((id) => completesGroupFor(board, player, id));
  if (givingTheirKey && !gettingOurKey) return false;

  const given = giving.reduce((sum, id) => sum + valueOf(ctx, id), givingCash);
  const gained = getting.reduce((sum, id) => sum + valueOf(ctx, id), gettingCash);
  return gained > given;
}

/**
 * An offer this bot would make, or null. Two shapes, in order of preference:
 *
 *   1. **A monopoly for a monopoly.** We hold the lot that completes a group for
 *      somebody who holds the lot that completes one for us. Cash tops it up
 *      until their own valuation says yes.
 *   2. **Cash for a deed that is worth more to us than to its owner** — a second
 *      railroad, a second utility. No colour group is involved, so nobody is
 *      being asked to hand over a key.
 *
 * The cash is the *smallest* amount that gets a yes, found by asking
 * `acceptTrade` — the partner's real policy, not a guess at it. Deterministic
 * and drawing no randomness, like every other decision in this file.
 */
/**
 * Whether a bot may interrupt a *person* with an offer this round.
 *
 * Whether a trade is good is `proposeTrade`'s question and always was. This is
 * the other one, and it is about manners rather than about value: an offer a
 * person did not ask for costs them attention, and a bot that made one every
 * turn would be answered by reflex rather than considered. So it is rationed —
 * a bot may interrupt once, then not again for `cooldown` rounds, and a decline
 * is what starts the wait.
 *
 * Pure, and here rather than in the scene, because "how often is too often" is a
 * decision about the game and not about the panel that shows it.
 */
export function mayInterrupt(
  round: number, lastOffered: number | undefined, cooldown: number,
): boolean {
  if (cooldown <= 0) return true;
  if (lastOffered === undefined) return true;
  return round - lastOffered >= cooldown;
}

export function proposeTrade(ctx: BotContext): TradeOffer | null {
  const budget = Math.max(0, ctx.player.cash - profileOf(ctx).reserve);
  return swapForMonopoly(ctx, budget) ?? buyOutright(ctx, budget);
}

/** Cash steps to search over. Finer than this buys nothing but iterations. */
const CASH_STEP = 10;

function swapForMonopoly(ctx: BotContext, budget: number): TradeOffer | null {
  const { player, players } = ctx;

  for (const wanted of keysHeldByOthers(ctx)) {
    const owner = players.find((p) => p.id === wanted.ownerId);
    if (!owner || owner.isBankrupt) continue;

    for (const key of ourKeysFor(ctx, owner)) {
      // Not out of the same group: swapping one brown lot for the other leaves
      // the group split exactly as it was, and both sides' valuations happily
      // say yes to it. Ask that the two keys belong to different groups and the
      // trade is what it claims to be — a monopoly each.
      if (key.group === wanted.group) continue;

      const base: TradeOffer = {
        ...emptyOffer(player.id, owner.id),
        fromTileIds: [key.id],
        toTileIds:   [wanted.id],
      };
      const offer = cheapestYes(ctx, owner, base, budget);
      if (offer) return offer;
    }
  }
  return null;
}

function buyOutright(ctx: BotContext, budget: number): TradeOffer | null {
  const { board, player, players } = ctx;

  for (const tile of board.tiles) {
    if (!isOwnable(tile) || tile.ownerId === null || tile.ownerId === player.id) continue;
    // A lone lot is somebody's key by definition, and `acceptTrade` holds those
    // back for a swap. What is buyable is a railroad or a utility we already
    // have one of.
    if (tile instanceof PropertyTile || !isStrategic(ctx, tile)) continue;

    const owner = players.find((p) => p.id === tile.ownerId);
    if (!owner || owner.isBankrupt) continue;

    const base: TradeOffer = { ...emptyOffer(player.id, owner.id), toTileIds: [tile.id] };
    const offer = cheapestYes(ctx, owner, base, budget);
    if (offer) return offer;
  }
  return null;
}

/**
 * The least cash that turns `base` into an offer `partner` accepts, or null if
 * even the whole budget will not. More cash is only ever more attractive to the
 * other side, so the predicate is monotonic and a binary search is exact.
 */
function cheapestYes(
  ctx: BotContext, partner: Player, base: TradeOffer, budget: number,
): TradeOffer | null {
  const partnerCtx: BotContext = { ...ctx, player: partner };
  const withCash = (cash: number): TradeOffer => ({ ...base, fromCash: cash });
  const yes = (cash: number): boolean => {
    const offer = withCash(cash);
    return validateTrade(ctx.board, ctx.players, offer).ok && acceptTrade(partnerCtx, offer);
  };

  const top = Math.floor(budget / CASH_STEP);
  if (!yes(top * CASH_STEP)) return null;

  let low = 0;
  let high = top;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (yes(mid * CASH_STEP)) high = mid;
    else                      low = mid + 1;
  }
  return withCash(low * CASH_STEP);
}

/** Lots somebody else holds that would complete a colour group for us. */
function keysHeldByOthers(ctx: BotContext): PropertyTile[] {
  return ctx.board.tiles.filter((t): t is PropertyTile => (
    t instanceof PropertyTile
    && t.ownerId !== null && t.ownerId !== ctx.player.id
    && completesGroupFor(ctx.board, ctx.player, t.id)
  ));
}

/**
 * Lots we hold that would complete a colour group for `them` — which is also to
 * say lots we can never complete ourselves, since they hold all the others.
 * Giving one away costs nothing but the rent it would have paid.
 */
function ourKeysFor(ctx: BotContext, them: Player): PropertyTile[] {
  return [...ctx.player.ownedTileIds]
    .map((id) => ctx.board.getTile(id))
    .filter((t): t is PropertyTile => (
      t instanceof PropertyTile && completesGroupFor(ctx.board, them, t.id)
    ))
    .sort((a, b) => a.price - b.price);   // give away the cheapest that will do
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
