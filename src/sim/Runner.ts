import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, type Card } from '@/cards/CardDeck';
import type { GameRules } from '@/game/Rules';
import { diceFor } from '@/game/Variants';
import {
  payRent, payTax, drawCard, isSelfTerminating, applyLandingRules, type LandingContext,
} from '@/game/Landing';
import { Auction, tileSubject, type AuctionSubject } from '@/game/Auction';
import {
  houseClaims, housesContested, houseReserve, nominateLot, type HouseClaim,
} from '@/game/Contention';
import { canBuildHouse, canBuildHotel, canUnmortgage } from '@/game/BuildRules';
import { executeTrade } from '@/game/Trade';
import {
  shouldBuy, nextBid, nextHouseBid, jailChoice, buildPlan, redeemPlan,
  acceptTrade, proposeTrade, type BotContext, type BotProfile,
} from '@/game/Bot';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';
import { gameById, decksFor, rulesFor, type Game } from '@/games';
import {
  applyTileEffect, effectContext, type TileEffectPayload,
} from '@/game/TileEffects';
import { checkInvariants, type Violation } from './Invariants';
import type { ArrivalRent } from '@/game/Rent';

// ─── Runner ───────────────────────────────────────────────────────────────────
// A whole game, played to the end, with no Phaser and no canvas.
//
// It is the *second* driver of the same model. `GameScene` is the first: it
// animates a move, shows a prompt, waits a beat so a person can read what
// happened, and ends the turn on a timer. This one does none of that — a move is
// a position change, every prompt is answered by `game/Bot.ts`, and a turn ends
// the instant its landing returns.
//
// What the two share is everything that decides anything: `Rent`, `Estate`,
// `Landing`, `BuildRules`, `Auction`, `Contention`, `Trade`, `TurnFlow` and the
// bot policy. What they do not share is *timing*, which is the honest division —
// there is no tween here to be slower than, and no clock to wait on.
//
// Two properties this file has to keep, or a batch is worthless:
//
//   * **Reproducible.** The only randomness is `rng`, seeded per game. Two runs
//     of the same seed play the same game, and the bots draw nothing.
//   * **Bounded.** A game that will not end is a result, not a hang: every run
//     has a turn cap and reports hitting it.

export interface SimPlayer {
  name?: string;
  profile?: BotProfile;
}

export interface SimOptions {
  /** Which game to play. A string is looked up; a `Game` is used as given. */
  game: string | Game;
  seed: number;
  /** How many seats. Names and policies default. */
  players: number | SimPlayer[];
  /** House rules and other switches over the game's own. */
  rules?: Partial<GameRules>;
  /** A game that has not finished by here is reported as unfinished, not hung. */
  maxTurns?: number;
  /** Stop and report the first broken invariant instead of playing on. */
  checkInvariants?: boolean;
}

export interface SimResult {
  gameId: string;
  seed: number;
  /** Null when the cap was hit, or when everybody went under at once. */
  winnerId: string | null;
  finished: boolean;
  turns: number;
  rounds: number;
  /** Seats that went bankrupt, in the order they did. */
  bankruptcies: string[];
  /** Cash each seat ended with, by id. */
  cash: Record<string, number>;
  /** Deeds each seat ended holding. */
  deeds: Record<string, number>;
  /**
   * Every tile that ended the game owned by somebody, by id. Counts alone say
   * how *much* of a board was played; this says *which* of it was — the check
   * that a board with three tracks is not two tracks of scenery.
   */
  tilesOwned: number[];
  housesBuilt: number;
  hotelsBuilt: number;
  /** True if the bank ran out of houses at any point. */
  houseShortage: boolean;
  auctions: number;
  trades: number;
  violations: Violation[];
}

const DEFAULT_MAX_TURNS = 2000;

export function simulate(options: SimOptions): SimResult {
  return new Simulation(options).run();
}

class Simulation {
  private readonly options: SimOptions;
  private readonly game: Game;
  private readonly rules: GameRules;
  private readonly board: Board;
  private readonly bank: Bank;
  private readonly dice;
  private readonly players: Player[];
  private readonly turns: TurnManager;
  private readonly chanceDeck: CardDeck;
  private readonly commDeck: CardDeck;
  private readonly effects: CardEffects;
  private readonly profiles = new Map<string, BotProfile | undefined>();

  private arrivalRent: ArrivalRent | null = null;
  private turnsTaken = 0;
  private over = false;
  private winnerId: string | null = null;
  private bankruptcies: string[] = [];
  private auctionsHeld = 0;
  private tradesMade = 0;
  private houseShortage = false;
  private violations: Violation[] = [];
  /** Deeds a bankruptcy handed back to the bank, waiting to be auctioned. */
  private queued: AuctionSubject[] = [];
  private contention: { claims: HouseClaim[]; requestedBy: string; lot: PropertyTile } | null = null;

  constructor(options: SimOptions) {
    this.options = options;

    // Cleared first: a `TurnManager` subscribes in its constructor, and a batch
    // reuses one process, so last game's listeners would still be attached.
    bus.clear();
    rng.seed(options.seed);

    this.game  = typeof options.game === 'string' ? gameById(options.game) : options.game;
    this.rules = rulesFor(this.game, options.rules);
    this.board = new Board(this.game.map, this.rules);
    this.bank  = new Bank(this.rules);
    this.dice  = diceFor(this.rules);

    const seats: SimPlayer[] = typeof options.players === 'number'
      ? Array.from({ length: options.players }, () => ({}))
      : options.players;

    this.players = seats.map((seat, i) => {
      const player = new Player(
        `p${i + 1}`, seat.name ?? `Player ${i + 1}`, TOKENS[i % TOKENS.length],
        true, this.rules.startingCash,
      );
      this.profiles.set(player.id, seat.profile);
      return player;
    });

    const decks = decksFor(this.game);
    this.chanceDeck = new CardDeck(decks.chance);
    this.commDeck   = new CardDeck(decks.community);
    this.effects    = new CardEffects(this.board, this.bank, this.players);
    this.turns      = new TurnManager(this.players, this.board, this.dice);

    this.listen();
  }

  // ── The loop ────────────────────────────────────────────────────────────────

  run(): SimResult {
    const cap = this.options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.turns.startTurn();

    while (!this.over && this.turnsTaken < cap) {
      this.turnsTaken++;
      const player = this.turns.currentPlayer;

      // Everything a player does before rolling, in the order the scene does it.
      this.tradeFor(player);
      this.developFor(player);
      if (player.inJail) this.leaveJail(player);

      this.turns.rollDice();

      // A phase a variant added can hold the turn — the speed die's bonus move
      // does. Nothing here animates, so it is finished the moment it returns.
      if (this.turns.isHeld) this.turns.resume();

      if (this.options.checkInvariants) {
        this.violations = checkInvariants({
          board: this.board, bank: this.bank, players: this.players,
          rules: this.rules, decks: [this.chanceDeck, this.commDeck],
        });
        if (this.violations.length) break;
      }
    }

    return this.result();
  }

  private result(): SimResult {
    const built = this.board.tiles.filter((t): t is PropertyTile => t instanceof PropertyTile);
    return {
      gameId: this.game.id,
      seed: this.options.seed,
      winnerId: this.winnerId,
      finished: this.over,
      turns: this.turnsTaken,
      rounds: this.turns.round,
      bankruptcies: this.bankruptcies,
      cash:  Object.fromEntries(this.players.map((p) => [p.id, p.cash])),
      deeds: Object.fromEntries(this.players.map((p) => [p.id, p.ownedTileIds.size])),
      tilesOwned: this.players.flatMap((p) => [...p.ownedTileIds]).sort((a, b) => a - b),
      housesBuilt: built.reduce((n, t) => n + t.houses, 0),
      hotelsBuilt: built.filter((t) => t.hasHotel).length,
      houseShortage: this.houseShortage,
      auctions: this.auctionsHeld,
      trades: this.tradesMade,
      violations: this.violations,
    };
  }

  // ── Driving ─────────────────────────────────────────────────────────────────

  private listen(): void {
    // A move is a position change. `TurnManager` has already set it; all that is
    // left is what the scene would do once its tween finished.
    bus.on('player:move', () => this.turns.resolveLanding());

    bus.on('rent:modifier', ({ rule }: { rule: ArrivalRent }) => { this.arrivalRent = rule; });

    bus.on('rent:pay', (payload: Parameters<typeof payRent>[1]) => {
      const outcome = payRent(this.context(), payload, this.arrivalRent);
      if (outcome.kind === 'salary') return;   // paid mid-walk; the turn goes on
      if (outcome.kind === 'none') return;
      this.arrivalRent = null;
      this.endTurn();
    });

    bus.on('tax:pay', ({ playerId, amount }: { playerId: string; amount: number }) => {
      payTax(this.context(), playerId, amount);
      this.endTurn();
    });

    // A tile asking for a rule it cannot resolve alone. The effect ends the turn
    // the way any other landing does — by emitting `player:landed`, or by moving
    // the player and letting the walk resolve it.
    bus.on('tile:effect', (payload: TileEffectPayload) => {
      applyTileEffect(effectContext(this.context()), payload);
    });

    bus.on('property:auction', (p: { tileId: number; playerId: string; price?: number }) => {
      this.decideBuy(p.tileId, p.playerId, p.price);
    });

    bus.on('card:draw', ({ playerId, deckType }: { playerId: string; deckType: string }) => {
      const player = this.players.find((q) => q.id === playerId)!;
      const deck   = deckType === 'chance' ? this.chanceDeck : this.commDeck;
      const card   = drawCard(deck);
      if (!card) { this.endTurn(); return; }

      this.effects.execute(card, player);
      // A card that moves the player resolves its own turn end, through the move
      // it causes or through `jail:enter`. Ending it here as well would end the
      // turn before the landing it just caused.
      if (!isSelfTerminating(card)) this.endTurn();
    });

    bus.on('jail:exit', ({ method, card, amount }: { method: string; card?: Card; amount?: number }) => {
      if (this.rules.freeParkingJackpot && amount) this.bank.addToPot(amount);
      if (method !== 'card' || !card) return;
      const deck = [this.chanceDeck, this.commDeck].find((d) => d.owns(card));
      deck?.returnToBottom(card);
    });

    bus.on('card:return', ({ cards }: { cards: Card[] }) => {
      for (const card of cards) {
        [this.chanceDeck, this.commDeck].find((d) => d.owns(card))?.returnToBottom(card);
      }
    });

    bus.on('jail:enter', () => this.endTurn());
    bus.on('jail:stay',  () => this.endTurn());

    // A free landing: Go, Just Visiting, Free Parking, your own deed. Nothing is
    // charged, the house rules that pay out do so, and the turn is over.
    bus.on('player:landed', ({ playerId, tileId }: { playerId: string; tileId: number }) => {
      applyLandingRules(this.context(), playerId, tileId);
      this.endTurn();
    });

    bus.on('player:bankrupt', (p: { playerId: string; creditorId: string | null; returned?: number[] }) => {
      this.bankruptcies.push(p.playerId);
      if (p.creditorId === null) this.queueEstate(p.returned ?? []);
    });

    bus.on('game:end', ({ winnerId }: { winnerId: string | null }) => {
      this.over = true;
      this.winnerId = winnerId;
    });
  }

  private context(): LandingContext {
    return {
      board: this.board, bank: this.bank, players: this.players,
      rules: this.rules, dice: this.dice,
    };
  }

  private botContext(player: Player): BotContext {
    return {
      board: this.board, bank: this.bank, player, players: this.players,
      profile: this.profiles.get(player.id),
    };
  }

  /**
   * End the turn — unless something is still under the hammer, which cannot
   * happen here: an auction runs to completion inside the call that opened it.
   * A held turn is resumed rather than ended, exactly as the scene does.
   */
  private endTurn(): void {
    if (this.over) return;
    if (this.turns.isHeld) this.turns.resume();
    else                   this.turns.endTurn();
  }

  // ── Decisions ───────────────────────────────────────────────────────────────

  private decideBuy(tileId: number, playerId: string, price?: number): void {
    const player = this.players.find((p) => p.id === playerId)!;
    const tile   = this.board.getTile(tileId);
    if (!isOwnable(tile)) { this.endTurn(); return; }

    if (shouldBuy(this.botContext(player), tile)) {
      this.bank.sellPropertyToPlayer(player, tile, price ?? tile.price);
      this.endTurn();
      return;
    }
    if (this.rules.noAuction) { this.endTurn(); return; }

    this.runAuction(tileSubject(tileId, tile.name), this.players);
    this.drainQueue();
    this.endTurn();
  }

  /** Round-robin bidding, played out in one call. */
  private runAuction(subject: AuctionSubject, bidders: Player[], reserve?: number): void {
    const auction = new Auction(subject, bidders, this.rules.bidIncrement, reserve);
    if (auction.complete) return;
    this.auctionsHeld++;

    // Bounded: every pass removes a bidder and every bid raises the floor, but a
    // policy that answered inconsistently would otherwise spin here.
    for (let guard = 0; guard < 500 && !auction.complete; guard++) {
      const bidder = auction.currentBidder;
      if (!bidder) break;
      const bid = this.bidFor(subject, bidder, auction.highBid, auction.minimumBid);
      if (bid === null || !auction.bid(bidder.id, bid)) auction.pass(bidder.id);
    }

    const result = auction.result;
    const winner = result?.winnerId
      ? this.players.find((p) => p.id === result.winnerId)
      : null;
    if (result && winner) this.award(result.subject, winner, result.amount);
  }

  private bidFor(
    subject: AuctionSubject, bidder: Player, high: number, minimum: number,
  ): number | null {
    const ctx = this.botContext(bidder);
    if (subject.kind === 'house') {
      const claim = this.contention?.claims.find((c) => c.player.id === bidder.id);
      return nextHouseBid(ctx, claim?.cheapest ?? 0, high, minimum);
    }
    const tile = this.board.getTile(subject.id);
    return isOwnable(tile) ? nextBid(ctx, tile, high, minimum) : null;
  }

  private award(subject: AuctionSubject, winner: Player, amount: number): void {
    if (subject.kind === 'tile') {
      const tile = this.board.getTile(subject.id);
      if (isOwnable(tile)) this.bank.sellPropertyToPlayer(winner, tile, amount);
      return;
    }
    if (subject.kind !== 'house' || !this.contention) return;
    const requested = this.contention.requestedBy === winner.id ? this.contention.lot : null;
    const lot = nominateLot(this.contention.claims, winner, requested);
    if (lot && canBuildHouse(this.board, this.bank, winner, lot).ok) {
      this.bank.buyHouse(winner, lot, amount);
    }
  }

  private queueEstate(tileIds: number[]): void {
    if (this.rules.noAuction) return;
    if (this.players.filter((p) => !p.isBankrupt).length < 2) return;
    this.queued.push(...tileIds
      .filter((id) => { const t = this.board.getTile(id); return isOwnable(t) && t.ownerId === null; })
      .map((id) => tileSubject(id, this.board.getTile(id).name)));
  }

  /** Sell a returned estate, deed by deed, before the turn that caused it ends. */
  private drainQueue(): void {
    for (let guard = 0; guard < 200 && this.queued.length && !this.over; guard++) {
      this.runAuction(this.queued.shift()!, this.players);
    }
    this.queued.length = 0;
  }

  private leaveJail(player: Player): void {
    const choice = jailChoice(this.botContext(player), this.rules.jailFine);
    if (choice === 'card') this.turns.useGetOutOfJailCard(player);
    if (choice === 'pay')  this.turns.payJailFine(player);
  }

  private tradeFor(player: Player): void {
    const offer = proposeTrade(this.botContext(player));
    if (!offer) return;
    const partner = this.players.find((p) => p.id === offer.toId);
    if (!partner || !acceptTrade(this.botContext(partner), offer)) return;
    if (executeTrade(this.board, this.players, offer)) this.tradesMade++;
  }

  /** Redeem what it can, then build what the plan asks for. */
  private developFor(player: Player): void {
    for (const tileId of redeemPlan(this.botContext(player))) {
      const tile = this.board.getTile(tileId);
      if (isOwnable(tile) && canUnmortgage(player, tile).ok) this.bank.unmortgage(player, tile);
    }

    for (let step = 0; step < 12; step++) {
      const next = buildPlan(this.botContext(player))[0];
      if (!next) break;
      const lot = this.board.getTile(next.tileId);
      if (!(lot instanceof PropertyTile)) break;

      if (next.kind === 'house' && this.startContention(player, lot)) break;

      const built = next.kind === 'hotel'
        ? canBuildHotel(this.board, this.bank, player, lot).ok && this.bank.buyHotel(player, lot)
        : canBuildHouse(this.board, this.bank, player, lot).ok && this.bank.buyHouse(player, lot);
      if (!built) break;
      if (this.bank.houses === 0) this.houseShortage = true;
    }
  }

  /** The last houses go under the hammer rather than to whoever asked first. */
  private startContention(builder: Player, lot: PropertyTile): boolean {
    if (!this.rules.houseAuctions) return false;
    if (!housesContested(this.board, this.bank, this.players)) return false;

    this.houseShortage = true;
    const claims = houseClaims(this.board, this.bank, this.players);
    this.contention = { claims, requestedBy: builder.id, lot };
    this.runAuction(
      { kind: 'house', id: lot.id, label: 'A house from the bank' },
      claims.map((c) => c.player),
      houseReserve(claims),
    );
    this.contention = null;
    return true;
  }
}

/** Eight pieces, and at most eight seats a simulation will ever deal. */
const TOKENS = [
  'topHat', 'car', 'dog', 'battleship', 'iron', 'boot', 'wheelbarrow', 'thimble',
] as const;
