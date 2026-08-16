import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import {
  buildingLevel, canBuild, canUnmortgage, ownsWholeGroup, unmortgageCost,
} from './BuildRules';
import { rungAt } from './BuildLadder';
import { countOwnedOfType } from './Rent';
import { holdingKind } from './Holdings';
import { RailroadTile, UtilityTile } from '@/tiles/SpecialTiles';
import { trafficOf } from './BoardOdds';
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
  /**
   * How a deed is *priced*, which is the axis 8d showed the three numbers above
   * are not on.
   *
   * - `price` — what it says on the deed, with a bump for one that completes a
   *   group. Every bot did this until M10c.
   * - `odds` — what it is likely to *earn*: how busy the square is
   *   (`game/BoardOdds.ts`) times the rent it would charge. A different question,
   *   and the one the printed price cannot answer.
   */
  valuation: 'price' | 'odds';
  /**
   * `odds` only: sell a deed somebody else needs, if the cash is this many times
   * what it is worth to us. The baseline never sells a key at any price, which
   * is a large part of why one game in twenty never forms a monopoly at all.
   * 0 keeps the old absolute veto.
   */
  keyPremium: number;
}

export const DEFAULT_PROFILE: BotProfile = {
  reserve: 150,
  auctionCeiling: 1.2,
  buildBuffer: 100,
  valuation: 'price',
  // 2.5 rather than 0 since M10c, and it is the one change in this file that a
  // measurement asked for outright: a bot that would never sell a key at any
  // price left **22 of 400 classic games with no monopoly on the board at all**,
  // running to the turn cap. Letting a key go for two and a half times its worth
  // took that to 0 of 400, shortened the median game from 58 rounds to 53, and
  // cost nothing head to head — 397/403 over 800 mirrored games.
  keyPremium: 2.5,
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
  valuation: 'price',
  keyPremium: 0,
};

/**
 * The different *shape* 8d asked for, and the one this milestone exists to
 * measure. Its three numbers sit between the other two on purpose — if it wins,
 * the win has to come from the valuation rather than from the dial settings that
 * were already shown not to matter.
 *
 * Four decisions change, and all four for the same reason: a deed is worth what
 * it will collect, not what it costs.
 *
 *   * **what to buy** — payback, not affordability
 *   * **what to bid** — a multiple of expected income, not of face value
 *   * **where to build** — the busiest group it may legally build on, not the
 *     cheapest lot it owns
 *   * **what to trade** — the same valuation on both sides, and a price at which
 *     it *will* part with somebody's key
 */
export const ODDS_PROFILE: BotProfile = {
  reserve: 100,
  auctionCeiling: 1.3,
  buildBuffer: 50,
  valuation: 'odds',
  keyPremium: 2.5,
};

export const PROFILES: Record<string, BotProfile> = {
  baseline:   DEFAULT_PROFILE,
  /** A copy of the baseline under another name — the control the mirror is
   *  checked against. Two identical policies must come out 50/50, or the
   *  measurement is measuring the harness. */
  /**
   * A copy of the baseline under another name. Not a policy — a **control**: two
   * identical policies have to come out 50/50, or `--mirror` is measuring itself
   * rather than the bots. It does (300/300, spread 0), which is what makes the
   * other numbers in this file worth quoting.
   */
  control:    { ...DEFAULT_PROFILE },
  aggressive: AGGRESSIVE_PROFILE,
  odds:       ODDS_PROFILE,
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

  const profile = profileOf(ctx);
  if (profile.valuation === 'odds') {
    // A deed that pays for itself inside a dozen laps is worth the reserve being
    // dipped into; one that does not can wait for the auction, where this policy
    // will bid what it is actually worth.
    // Deliberately the same rule as the baseline, and this is a *result* rather
    // than an omission. Buying by payback — dipping into the reserve for a busy
    // square — was measured and lost about four points on its own (43% to 47%
    // over 600 mirrored games when it was taken back out). The model does not
    // see that a deed bought is also a deed denied, and with two players the
    // only other bidder is the opponent.
    return player.cash - price >= profile.reserve;
  }

  return player.cash - price >= profile.reserve;
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

  // What it is worth, rather than a fraction of what it says on the card. Eight
  // laps of expected income is the yardstick: long enough that a busy square is
  // worth over the odds, short enough that a quiet one is not.
  // Eight laps of expected income, rather than a fraction of what the card says.
  // Capping it at the printed price made no difference over 800 games either
  // way — with two players almost nothing is declined, so almost nothing reaches
  // an auction, and this is the decision with the least leverage of the four.
  const worth = profile.valuation === 'odds'
    ? Math.floor(expectedIncome(ctx, tile) * 8)
    : Math.floor(tile.price * profile.auctionCeiling);

  const ceiling = strategic
    ? Math.floor(worth * (profile.valuation === 'odds' ? 1.6 : 1) + (profile.valuation === 'odds' ? 0 : tile.price * 0.5))
    : worth;
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

  const developed = ctx.board.tiles.some((t) => buildingLevel(t) > 0);
  if (developed && player.cash >= fine + profileOf(ctx).reserve) return 'pay';
  return 'roll';
}

// ─── Development ──────────────────────────────────────────────────────────────

export interface BuildStep {
  tileId: number;
  /**
   * Which kind of building the next rung puts up — `house`, `hotel`, and on a
   * board that has them `skyscraper`. It is reported rather than chosen: the
   * ladder decides what comes next, and the bot only decides *where*.
   */
  kind: string;
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

  // Cheapest-first is what the baseline does, and it is why it puts its money
  // into the browns. The `odds` policy spends where a house *earns* most per
  // dollar — which on the classic board is the oranges, and is worked out rather
  // than known.
  const lots = [...player.ownedTileIds]
    .map((id) => board.getTile(id))
    .filter((t): t is PropertyTile => t instanceof PropertyTile)
    .sort(profile.valuation === 'odds'
      // Best group first, cheapest lot within it — so a group is finished rather
      // than a scattering of good squares half-built.
      ? (a, b) => (groupYield(ctx, b) - groupYield(ctx, a)) || (a.houseCost - b.houseCost)
      : (a, b) => a.houseCost - b.houseCost);

  for (const lot of lots) {
    // One question instead of two since M12d, and a board that adds a rung above
    // the hotel is built to the top of it without `Bot.ts` learning its name.
    if (!canBuild(board, bank, player, lot).ok) continue;
    if (spent + lot.houseCost > budget) continue;
    const rung = rungAt(board.rules.buildLadder, lot.type, lot.level + 1);
    if (!rung) continue;
    steps.push({ tileId: lot.id, kind: rung.kind.id });
    spent += lot.houseCost;
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

  if (givingTheirKey && !gettingOurKey) {
    // The veto used to be absolute, and that is a large part of why one classic
    // game in twenty never forms a monopoly at all: the only deed worth asking
    // for is the only deed nobody will ever sell, so four players sit on four
    // part-groups until the turn cap. A policy with a `keyPremium` will sell —
    // for enough. Everything a monopoly is worth to *them* is still coming out
    // of the price, because it is `valueOf` that the premium multiplies.
    const premium = profileOf(ctx).keyPremium;
    if (premium <= 0) return false;

    const keys = giving.filter((id) => completesGroupFor(board, other!, id));
    const asking = keys.reduce((sum, id) => sum + valueOf(ctx, id), 0) * premium;
    if (gettingCash < asking) return false;
  }

  // Holdings count at what the kind says one is worth. That is the whole of the
  // general answer — a bot can price a thing it has never heard of, and cannot
  // be expected to know what *playing* one would be worth, which is why the
  // spending half is a per-game policy and not this function's business.
  const givingHeld  = iAmProposer ? offer.fromHoldings : offer.toHoldings;
  const gettingHeld = iAmProposer ? offer.toHoldings : offer.fromHoldings;

  const given = giving.reduce((sum, id) => sum + valueOf(ctx, id), givingCash)
    + worthOfHoldings(givingHeld);
  const gained = getting.reduce((sum, id) => sum + valueOf(ctx, id), gettingCash)
    + worthOfHoldings(gettingHeld);
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
  return swapForMonopoly(ctx, budget)
      ?? buyKeyForCash(ctx, budget)
      ?? buyOutright(ctx, budget);
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

/**
 * Cash for the one lot that completes a group for us, with nothing going back.
 *
 * The third shape, and the one that needs no *mutual* monopoly to be possible —
 * which is the point. A swap only happens when two players are each one lot
 * short of two different groups, and a board where that never lines up is a
 * board where nobody ever builds. Whether the owner will part with it is
 * `acceptTrade`'s decision and depends on their `keyPremium`; a baseline
 * opponent still says no at any price, so this shape simply finds nothing
 * against one.
 */
function buyKeyForCash(ctx: BotContext, budget: number): TradeOffer | null {
  const { player, players } = ctx;
  if (profileOf(ctx).keyPremium <= 0) return null;

  // The dearest key first: if only one purchase is affordable it should be the
  // one that earns most, which is the same yardstick the rest of this policy uses.
  const wanted = keysHeldByOthers(ctx)
    .slice()
    .sort((a, b) => valueOf(ctx, b.id) - valueOf(ctx, a.id));

  for (const key of wanted) {
    const owner = players.find((p) => p.id === key.ownerId);
    if (!owner || owner.isBankrupt) continue;

    const base: TradeOffer = { ...emptyOffer(player.id, owner.id), toTileIds: [key.id] };
    const offer = cheapestYes(ctx, owner, base, budget);
    if (offer) return offer;
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

  if (profileOf(ctx).valuation === 'odds') {
    // The same yardstick the auction uses, so a bot does not value a deed one
    // way across the table and another under the hammer.
    const worth = Math.floor(expectedIncome(ctx, tile) * 8);
    return isStrategic(ctx, tile) ? Math.floor(worth * 1.6) : Math.max(worth, tile.mortgage);
  }
  return isStrategic(ctx, tile) ? Math.floor(tile.price * 1.5) : tile.price;
}

/**
 * What a colour *group* returns for the money, per lap: the rent a first house
 * adds across all of it, weighted by how busy each square is, over what building
 * out the group costs.
 *
 * A **group** and not a lot, which was the first draft and lost. Cheapest-lot-
 * first — the baseline — is not really about cheapness: it finishes one group
 * before starting another, and a finished group is what wins. Ranking individual
 * lots by yield scattered the money across the best squares of several groups
 * and developed none of them. So the odds go into choosing *which* group to
 * pour money into, and inside it the cheapest lot still comes first.
 */
function groupYield(ctx: BotContext, lot: PropertyTile): number {
  const group = ctx.board.groupTiles(lot.group);
  let gain = 0;
  let cost = 0;
  for (const member of group) {
    // What the *next* rung would add, whatever rung that is — the top of the
    // table rather than a literal 5, so a board with skyscrapers is valued to
    // the top of its own ladder instead of stopping at the hotel.
    const top   = member.rentTiers.length - 1;
    const level = Math.min(member.level, top);
    const step  = (member.rentTiers[Math.min(level + 1, top)] ?? 0) - (member.rentTiers[level] ?? 0);
    gain += trafficOf(ctx.board, member.id) * step;
    cost += member.houseCost;
  }
  return gain / Math.max(1, cost);
}

// ─── Valuing a deed by what it will collect ───────────────────────────────────
// The `odds` policy's half of the file. Pure functions of the board and who owns
// what, drawing no randomness — the same two rules every decision above obeys.

/**
 * The rent this deed would charge at the level its owner could plausibly reach.
 *
 * Not the rent it charges *now*, which is nearly always the bare tier and would
 * make every undeveloped lot look worthless. A lot whose group can still be
 * completed is priced at three houses — where the classic rent ladder is
 * steepest, and where a real game usually stops. A lot in a group somebody else
 * already holds a piece of is priced at what it will actually collect.
 */
function reachableRent(ctx: BotContext, tile: Tile & Ownable): number {
  const { board, player } = ctx;

  if (tile instanceof PropertyTile) {
    const group = board.groupTiles(tile.group);
    const free  = group.filter((t) => t.ownerId === null || t.ownerId === player.id).length;
    // The *deed's* earning power, not the developed lot's. Pricing a lot at its
    // three-house rent was the first draft, and it valued houses nobody had paid
    // for: every payback came out under a lap, so the policy bought down to zero
    // cash and bid its whole stack at auction. It lost 60/40 over 800 mirrored
    // games — the measurement that made this line what it is. What a house adds
    // is a separate decision with its own cost, and `houseYield` makes it.
    if (free === group.length) return tile.rentTiers[0] * board.rules.monopolyRent;
    return tile.rentTiers[0];
  }

  if (tile instanceof RailroadTile) {
    return tile.rentFor(countOwnedOfType(board, player, tile.type) + 1);
  }
  if (tile instanceof UtilityTile) {
    // Seven is the average roll, which is what a utility charges a multiple of.
    return tile.rentMultiplier(countOwnedOfType(board, player, 'utility') + 1) * 7;
  }
  return 0;
}

/**
 * What a deed is expected to collect per lap of the board: how busy the square
 * is, times what it charges. This is the number the printed price does not
 * contain, and the whole reason this policy exists.
 */
function expectedIncome(ctx: BotContext, tile: Tile & Ownable): number {
  return trafficOf(ctx.board, tile.id) * reachableRent(ctx, tile);
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

/** What a side of an offer is worth in holdings, at each kind's declared value. */
function worthOfHoldings(holdings: Record<string, number>): number {
  return Object.entries(holdings).reduce(
    (sum, [name, count]) => sum + count * (holdingKind(name)?.value ?? 0), 0,
  );
}
