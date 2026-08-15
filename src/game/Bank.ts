import { CLASSIC_RULES, type GameRules } from './Rules';
import {
  consumedBy, costOf, levelById, refundOf, rungAt, topLevel, type BuildLevel,
} from './BuildLadder';

/** The slice of the rule set the bank actually needs. */
type BankRules = Pick<GameRules,
  'houseLimit' | 'hotelLimit' | 'housesBeforeHotel' | 'mortgageInterest' | 'buildLadder'>;
import type { Player } from './Player';
import type { Ownable, Tile } from '@/tiles/Tile';

export class Bank {
  cash: number = Infinity; // Bank has unlimited cash per standard rules
  /**
   * What is left in the box, by building kind. A `Record` rather than two
   * numbers since M12d, because a game may stock five kinds — and a census that
   * counted only houses and hotels would let skyscrapers be minted out of
   * nothing, which is exactly the class of bug `sim/Invariants.ts` exists for.
   */
  stock: Record<string, number> = {};
  /** Fines and taxes waiting on Free Parking — zero unless that house rule is on. */
  pot: number = 0;

  /** What may be built at all, and what one of each replaces. */
  readonly ladder: BuildLevel[];

  /** What lifting a mortgage costs over the mortgage itself. */
  readonly mortgageInterest: number;

  /** The building supply is finite, and how finite is a rule. */
  constructor(rules: BankRules = CLASSIC_RULES) {
    this.ladder = rules.buildLadder;
    for (const level of this.ladder) this.stock[level.id] = level.supply;
    this.mortgageInterest = rules.mortgageInterest;
  }

  /**
   * The classic two kinds by name. Kept as accessors rather than fields because
   * a great deal reads them — the HUD, the report, the bot, the contention rule
   * — and "how many houses are left" is still a real question on every board
   * here. Anything that has to be right for *all* five kinds asks `stock`.
   */
  get houses(): number { return this.stock.house ?? 0; }
  set houses(n: number) { this.stock.house = n; }
  get hotels(): number { return this.stock.hotel ?? 0; }
  set hotels(n: number) { this.stock.hotel = n; }

  /** How many houses a hotel is worth, both going up and coming down. */
  get housesPerHotel(): number {
    return levelById(this.ladder, 'house')?.perTile ?? CLASSIC_RULES.housesBeforeHotel;
  }

  // ─── Cash transfers ──────────────────────────────────────────────────────────

  collectTax(player: Player, amount: number): void {
    const actual = Math.min(player.cash, amount);
    player.pay(actual);
  }

  payPlayer(player: Player, amount: number): void {
    player.receive(amount);
  }

  transferBetweenPlayers(debtor: Player, creditor: Player, amount: number): void {
    if (debtor.cash >= amount) {
      debtor.pay(amount);
      creditor.receive(amount);
    } else {
      // Debtor can't fully pay — bankrupt handling
      creditor.receive(debtor.cash);
      debtor.cash = 0;
    }
  }

  // ─── Property purchase ───────────────────────────────────────────────────────
  // Ownable, not PropertyTile: railroads and utilities change hands the same way,
  // and used to be bought through a hand-written cast in GameScene instead.

  /** `price` overrides the deed's face value — an auction sells at the bid. */
  sellPropertyToPlayer(player: Player, tile: Ownable, price: number = tile.price): boolean {
    if (!player.canAfford(price) || tile.ownerId !== null) return false;
    player.pay(price);
    tile.ownerId = player.id;
    player.ownedTileIds.add(tile.id);
    return true;
  }

  // ─── Mortgage ────────────────────────────────────────────────────────────────

  mortgage(player: Player, tile: Ownable): boolean {
    if (tile.ownerId !== player.id || tile.isMortgaged) return false;
    tile.isMortgaged = true;
    player.receive(tile.mortgage);
    return true;
  }

  unmortgage(player: Player, tile: Ownable): boolean {
    // The rate is the rule set's, not a literal — `mortgageInterest` governs both
    // this and the fee for *receiving* a mortgaged deed, so one number turns the
    // whole rule off.
    const cost = Math.floor(tile.mortgage * (1 + this.mortgageInterest));
    if (tile.ownerId !== player.id || !tile.isMortgaged || !player.canAfford(cost)) return false;
    tile.isMortgaged = false;
    player.pay(cost);
    return true;
  }

  // ─── Building ────────────────────────────────────────────────────────────────
  // One rung up, one rung down, whatever the rung happens to be. The bank still
  // knows no rules — it will happily put a house on a lot whose colour group you
  // do not own; `game/BuildRules.ts` is what says whether it may.

  /** What one costs on this tile — a lot's own house cost, or the level's. */
  priceOf(tile: Tile & Ownable, level: number): number {
    const rung = rungAt(this.ladder, tile.type, level);
    return rung ? costOf(rung.kind, houseCostOf(tile)) : 0;
  }

  /**
   * Climb one rung. `price` overrides the printed cost — a contested house
   * sells at the bid.
   *
   * The exchange is what the ladder describes: a hotel takes one hotel out of
   * the box and puts four houses back. Two rungs of the same kind exchange
   * nothing, which is why the third house is just a house.
   */
  build(player: Player, tile: Tile & Ownable, price?: number): boolean {
    const next = tile.level + 1;
    const rung = rungAt(this.ladder, tile.type, next);
    if (!rung) return false;
    if ((this.stock[rung.kind.id] ?? 0) <= 0) return false;

    const cost = price ?? costOf(rung.kind, houseCostOf(tile));
    if (!player.canAfford(cost)) return false;

    player.pay(cost);
    this.stock[rung.kind.id]--;
    const returned = consumedBy(this.ladder, tile.type, tile.level);
    if (returned) this.stock[returned.kind.id] += returned.count;
    tile.level = next;
    return true;
  }

  /**
   * Climb one rung down, paying back half. Coming off a hotel needs four houses
   * to come *out* of the box — without them the sale would silently destroy
   * them, which is why `canSell` asks first.
   */
  sell(player: Player, tile: Tile & Ownable): boolean {
    const rung = rungAt(this.ladder, tile.type, tile.level);
    if (!rung) return false;

    const needed = consumedBy(this.ladder, tile.type, tile.level - 1);
    if (needed && (this.stock[needed.kind.id] ?? 0) < needed.count) return false;

    player.receive(refundOf(rung.kind, houseCostOf(tile)));
    this.stock[rung.kind.id]++;
    if (needed) this.stock[needed.kind.id] -= needed.count;
    tile.level = tile.level - 1;
    return true;
  }

  /** The top rung a tile of this type can reach. */
  topLevelFor(tile: Tile): number {
    return topLevel(this.ladder, tile.type);
  }

  // ─── Free Parking pot (house rule) ───────────────────────────────────────────

  addToPot(amount: number): void {
    if (amount > 0) this.pot += amount;
  }

  /** Empty the pot into a player's hand. Returns what they collected. */
  takePot(player: Player): number {
    const won = this.pot;
    this.pot = 0;
    player.receive(won);
    return won;
  }

  toJSON() {
    return { stock: { ...this.stock }, pot: this.pot };
  }
}

/**
 * What a building costs on a tile that has no `houseCost` of its own. A railroad
 * has no such field — its depot carries a flat price on the level instead — so
 * this is only ever the fallback for a level that declares no `cost`.
 */
function houseCostOf(tile: Tile & Ownable): number {
  return (tile as { houseCost?: number }).houseCost ?? 0;
}
