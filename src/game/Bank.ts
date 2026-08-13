import { CLASSIC_RULES, type GameRules } from './Rules';

/** The slice of the rule set the bank actually needs. */
type BankRules = Pick<GameRules, 'houseLimit' | 'hotelLimit' | 'housesBeforeHotel'>;
import type { Player } from './Player';
import type { PropertyTile } from '@/tiles/PropertyTile';
import type { Ownable } from '@/tiles/Tile';

export class Bank {
  cash: number = Infinity; // Bank has unlimited cash per standard rules
  houses: number;
  hotels: number;
  /** Fines and taxes waiting on Free Parking — zero unless that house rule is on. */
  pot: number = 0;

  /** How many houses a hotel is worth, both going up and coming down. */
  readonly housesPerHotel: number;

  /** The building supply is finite, and how finite is a rule. */
  constructor(rules: BankRules = CLASSIC_RULES) {
    this.houses = rules.houseLimit;
    this.hotels = rules.hotelLimit;
    this.housesPerHotel = rules.housesBeforeHotel;
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
    const cost = Math.floor(tile.mortgage * 1.1); // 110% of mortgage value
    if (tile.ownerId !== player.id || !tile.isMortgaged || !player.canAfford(cost)) return false;
    tile.isMortgaged = false;
    player.pay(cost);
    return true;
  }

  // ─── Houses / Hotels ─────────────────────────────────────────────────────────

  /** `price` overrides the printed cost — a contested house sells at the bid. */
  buyHouse(player: Player, tile: PropertyTile, price: number = tile.houseCost): boolean {
    if (this.houses <= 0 || !player.canAfford(price)) return false;
    if (tile.houses >= this.housesPerHotel || tile.hasHotel) return false;
    player.pay(price);
    tile.houses++;
    this.houses--;
    return true;
  }

  buyHotel(player: Player, tile: PropertyTile): boolean {
    if (this.hotels <= 0 || tile.houses !== this.housesPerHotel || tile.hasHotel) return false;
    if (!player.canAfford(tile.houseCost)) return false;
    player.pay(tile.houseCost); // one more house-cost payment
    tile.hasHotel = true;
    tile.houses = 0;
    this.hotels--;
    this.houses += this.housesPerHotel;   // the houses go back to the bank
    return true;
  }

  sellHouse(player: Player, tile: PropertyTile): boolean {
    if (tile.houses <= 0) return false;
    player.receive(Math.floor(tile.houseCost / 2));
    tile.houses--;
    this.houses++;
    return true;
  }

  sellHotel(player: Player, tile: PropertyTile): boolean {
    if (!tile.hasHotel) return false;
    player.receive(Math.floor(tile.houseCost / 2));
    tile.hasHotel = false;
    this.hotels++;
    if (this.houses >= this.housesPerHotel) {
      tile.houses = this.housesPerHotel;
      this.houses -= this.housesPerHotel;
    }
    return true;
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
    return { houses: this.houses, hotels: this.hotels, pot: this.pot };
  }
}
