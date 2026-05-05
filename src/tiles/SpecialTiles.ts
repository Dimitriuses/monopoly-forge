import { Tile, type TileDefinition } from './Tile';
import { bus } from '@/utils/EventBus';
import { GO_SALARY } from '@/config';

// ─── Railroad ─────────────────────────────────────────────────────────────────
const RAILROAD_RENT = [25, 50, 100, 200]; // indexed by (railroads owned - 1)

export class RailroadTile extends Tile {
  readonly price: number;
  readonly mortgage: number;
  ownerId: string | null = null;
  isMortgaged: boolean = false;

  constructor(def: TileDefinition) {
    super(def);
    this.price = def.price ?? 200;
    this.mortgage = def.mortgage ?? 100;
  }

  rentFor(ownedCount: number): number {
    if (this.isMortgaged) return 0;
    return RAILROAD_RENT[Math.min(ownedCount, 4) - 1] ?? 25;
  }

  onLand(playerId: string): void {
    if (!this.ownerId || this.isMortgaged) {
      bus.emit('property:auction', { tileId: this.id, playerId });
      return;
    }
    if (this.ownerId === playerId) return;
    // TurnManager resolves ownedCount from Bank
    bus.emit('rent:pay', { debtorId: playerId, creditorId: this.ownerId, tileId: this.id });
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
export class UtilityTile extends Tile {
  readonly price: number;
  readonly mortgage: number;
  ownerId: string | null = null;
  isMortgaged: boolean = false;

  constructor(def: TileDefinition) {
    super(def);
    this.price = def.price ?? 150;
    this.mortgage = def.mortgage ?? 75;
  }

  /** multiplier: 4× if 1 owned, 10× if both owned */
  rentMultiplier(ownedCount: number): number {
    return ownedCount === 2 ? 10 : 4;
  }

  onLand(playerId: string): void {
    if (!this.ownerId || this.isMortgaged) {
      bus.emit('property:auction', { tileId: this.id, playerId });
      return;
    }
    if (this.ownerId === playerId) return;
    bus.emit('rent:pay', { debtorId: playerId, creditorId: this.ownerId, tileId: this.id });
  }
}

// ─── Tax ──────────────────────────────────────────────────────────────────────
export class TaxTile extends Tile {
  readonly amount: number;

  constructor(def: TileDefinition) {
    super(def);
    this.amount = def.amount ?? 0;
  }

  onLand(playerId: string): void {
    bus.emit('tax:pay', { playerId, amount: this.amount, tileId: this.id });
  }
}

// ─── Chance / Community Chest ─────────────────────────────────────────────────
export class CardTile extends Tile {
  onLand(playerId: string): void {
    bus.emit('card:draw', { playerId, deckType: this.type, tileId: this.id });
  }
}

// ─── Jail ─────────────────────────────────────────────────────────────────────
export class JailTile extends Tile {
  onLand(_playerId: string): void {
    // Dual-purpose tile: landing here = Just Visiting (no effect).
    // Being sent here is handled by TurnManager / GoToJailTile.
  }
}

// ─── Go To Jail ───────────────────────────────────────────────────────────────
export class GoToJailTile extends Tile {
  onLand(playerId: string): void {
    bus.emit('jail:enter', { playerId, reason: 'tile' });
  }
}

// ─── Go ───────────────────────────────────────────────────────────────────────
export class GoTile extends Tile {
  onLand(playerId: string): void {
    // Passing handled by Board; landing gives same $200 (or $400 with house rule)
    bus.emit('player:landed', { playerId, tileId: this.id });
  }

  override onPass(playerId: string): void {
    bus.emit('rent:pay', {
      debtorId: 'bank',
      creditorId: playerId,
      amount: GO_SALARY,
      tileId: this.id,
      reason: 'go',
    });
  }
}

// ─── Free Parking ─────────────────────────────────────────────────────────────
export class FreeParkingTile extends Tile {
  onLand(playerId: string): void {
    // Default: nothing happens. House rule variant emits jackpot event.
    bus.emit('player:landed', { playerId, tileId: this.id });
  }
}
