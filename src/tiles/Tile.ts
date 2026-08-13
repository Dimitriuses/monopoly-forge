import type { ColorGroup } from '@/config';

// ─── TileDefinition ──────────────────────────────────────────────────────────
// Plain data shape used in config.ts BOARD_TILES array.

/** The types the engine ships with. A game may register more — see tiles/registry.ts. */
export type BuiltInTileType =
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

/**
 * A tile's kind. The built-ins are named so they autocomplete and so a typo in
 * `'railroad'` is still caught, but the type is open: `registerTileType` can add
 * one the engine has never heard of, and `createTile` resolves it by name.
 */
export type TileType = BuiltInTileType | (string & {});

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

// ─── Ownable ──────────────────────────────────────────────────────────────────
// What the bank, the build rules and the property panel need from a tile that
// can change hands. Properties, railroads and utilities all satisfy it; the rest
// of the board does not, and `isOwnable` is the only test anything should apply.

export interface Ownable {
  readonly id: number;
  readonly name: string;
  readonly price: number;
  readonly mortgage: number;
  ownerId: string | null;
  isMortgaged: boolean;
}

export function isOwnable(tile: Tile): tile is Tile & Ownable {
  return 'ownerId' in tile;
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
