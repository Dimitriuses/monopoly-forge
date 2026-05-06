import { Tile, type TileDefinition } from './Tile';
import { bus } from '@/utils/EventBus';
import { GO_SALARY } from '@/config';

// ─── Railroad ─────────────────────────────────────────────────────────────────
const RAILROAD_RENT = [25, 50, 100, 200];

export class RailroadTile extends Tile {
  readonly price: number;
  readonly mortgage: number;
  ownerId: string | null = null;
  isMortgaged: boolean = false;

  constructor(def: TileDefinition) {
    super(def);
    this.price    = def.price    ?? 200;
    this.mortgage = def.mortgage ?? 100;
  }

  rentFor(ownedCount: number): number {
    if (this.isMortgaged) return 0;
    return RAILROAD_RENT[Math.min(ownedCount, 4) - 1] ?? 25;
  }

  onLand(playerId: string): void {
    // Unowned — offer to buy
    if (!this.ownerId) {
      bus.emit('property:auction', { tileId: this.id, playerId, price: this.price });
      return;
    }
    // Mortgaged or own tile — free pass
    if (this.isMortgaged || this.ownerId === playerId) {
      bus.emit('player:landed', { playerId, tileId: this.id });
      return;
    }
    // Owned by someone else — pay rent (GameScene resolves ownedCount)
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
    this.price    = def.price    ?? 150;
    this.mortgage = def.mortgage ?? 75;
  }

  rentMultiplier(ownedCount: number): number {
    return ownedCount === 2 ? 10 : 4;
  }

  onLand(playerId: string): void {
    if (!this.ownerId) {
      bus.emit('property:auction', { tileId: this.id, playerId, price: this.price });
      return;
    }
    if (this.isMortgaged || this.ownerId === playerId) {
      bus.emit('player:landed', { playerId, tileId: this.id });
      return;
    }
    bus.emit('rent:pay', { debtorId: playerId, creditorId: this.ownerId, tileId: this.id });
  }
}

// ─── Tax ──────────────────────────────────────────────────────────────────────
export class TaxTile extends Tile {
  readonly amount: number;
  constructor(def: TileDefinition) { super(def); this.amount = def.amount ?? 0; }

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

// ─── Jail (Just Visiting) ─────────────────────────────────────────────────────
export class JailTile extends Tile {
  onLand(playerId: string): void {
    // Landing here normally = Just Visiting: nothing happens, end turn
    bus.emit('player:landed', { playerId, tileId: this.id });
  }
}

// ─── Go To Jail ───────────────────────────────────────────────────────────────
export class GoToJailTile extends Tile {
  onLand(playerId: string): void {
    // GameScene jail:enter handler moves the token and ends the turn
    bus.emit('jail:enter', { playerId, reason: 'tile' });
  }
}

// ─── Go ───────────────────────────────────────────────────────────────────────
export class GoTile extends Tile {
  onLand(playerId: string): void {
    bus.emit('player:landed', { playerId, tileId: this.id });
  }

  override onPass(playerId: string): void {
    bus.emit('rent:pay', {
      debtorId: 'bank', creditorId: playerId,
      amount: GO_SALARY, tileId: this.id, reason: 'go',
    });
  }
}

// ─── Free Parking ─────────────────────────────────────────────────────────────
export class FreeParkingTile extends Tile {
  onLand(playerId: string): void {
    bus.emit('player:landed', { playerId, tileId: this.id });
  }
}
