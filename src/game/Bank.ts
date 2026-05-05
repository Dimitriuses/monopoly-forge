import { HOUSE_LIMIT, HOTEL_LIMIT } from '@/config';
import type { Player } from './Player';
import type { PropertyTile } from '@/tiles/PropertyTile';

export class Bank {
  cash: number = Infinity; // Bank has unlimited cash per standard rules
  houses: number = HOUSE_LIMIT;
  hotels: number = HOTEL_LIMIT;

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

  sellPropertyToPlayer(player: Player, tile: PropertyTile): boolean {
    if (!player.canAfford(tile.price) || tile.ownerId !== null) return false;
    player.pay(tile.price);
    tile.ownerId = player.id;
    player.ownedTileIds.add(tile.id);
    return true;
  }

  // ─── Mortgage ────────────────────────────────────────────────────────────────

  mortgage(player: Player, tile: PropertyTile): boolean {
    if (tile.ownerId !== player.id || tile.isMortgaged) return false;
    tile.isMortgaged = true;
    player.receive(tile.mortgage);
    return true;
  }

  unmortgage(player: Player, tile: PropertyTile): boolean {
    const cost = Math.floor(tile.mortgage * 1.1); // 110% of mortgage value
    if (tile.ownerId !== player.id || !tile.isMortgaged || !player.canAfford(cost)) return false;
    tile.isMortgaged = false;
    player.pay(cost);
    return true;
  }

  // ─── Houses / Hotels ─────────────────────────────────────────────────────────

  buyHouse(player: Player, tile: PropertyTile): boolean {
    if (this.houses <= 0 || !player.canAfford(tile.houseCost)) return false;
    if (tile.houses >= 4 || tile.hasHotel) return false;
    player.pay(tile.houseCost);
    tile.houses++;
    this.houses--;
    return true;
  }

  buyHotel(player: Player, tile: PropertyTile): boolean {
    if (this.hotels <= 0 || tile.houses !== 4 || tile.hasHotel) return false;
    if (!player.canAfford(tile.houseCost)) return false;
    player.pay(tile.houseCost); // one more house-cost payment
    tile.hasHotel = true;
    tile.houses = 0;
    this.hotels--;
    this.houses += 4; // return the 4 houses to the bank
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
    if (this.houses >= 4) {
      tile.houses = 4;
      this.houses -= 4;
    }
    return true;
  }

  toJSON() {
    return { houses: this.houses, hotels: this.hotels };
  }
}
