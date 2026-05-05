import type { ColorGroup } from '@/config';

// ─── TileDefinition ──────────────────────────────────────────────────────────
// Plain data shape used in config.ts BOARD_TILES array.

export type TileType =
  | 'go'
  | 'property'
  | 'railroad'
  | 'utility'
  | 'tax'
  | 'chance'
  | 'communityChest'
  | 'jail'
  | 'freeParking'
  | 'goToJail';

export interface TileDefinition {
  id: number;
  type: TileType;
  name: string;
  // Property / Railroad / Utility
  price?: number;
  mortgage?: number;
  // Property only
  group?: ColorGroup;
  houseCost?: number;
  /** rent[0]=bare, [1]=1h, [2]=2h, [3]=3h, [4]=4h, [5]=hotel */
  rent?: [number, number, number, number, number, number];
  // Tax only
  amount?: number;
}

// ─── Base Tile class ──────────────────────────────────────────────────────────

export abstract class Tile {
  readonly id: number;
  readonly type: TileType;
  readonly name: string;

  constructor(def: TileDefinition) {
    this.id = def.id;
    this.type = def.type;
    this.name = def.name;
  }

  /**
   * Called by TurnManager when a player lands on this tile.
   * Subclasses implement the actual landing effect.
   */
  abstract onLand(playerId: string): void;

  /** Optional: called when a player passes this tile (only Go uses this) */
  onPass(_playerId: string): void {}

  toJSON(): object {
    return { id: this.id, type: this.type, name: this.name };
  }
}
