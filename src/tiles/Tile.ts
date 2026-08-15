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
  /**
   * One rent per rung of the ladder, plus the bare rate at [0]. Six on the
   * classic board; a game that builds skyscrapers wants seven. It stopped being
   * a six-tuple in M12d — how many a lot needs is the *game's* question, and a
   * map has no economy, so `validateGame` is what checks the two agree.
   */
  rent?: number[];
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
  /**
   * Which rung of the build ladder is standing here — 0 for bare, 5 for a hotel
   * on the classic board (`game/BuildLadder.ts`). It lives on `Ownable` rather
   * than on a lot because a railroad can hold a train depot, and the level a
   * tile can reach comes from its *type*.
   *
   * It is also the index into a lot's rent table, which is what made replacing
   * `houses: number` + `hasHotel: boolean` cheap rather than invasive.
   */
  level: number;
}

export function isOwnable(tile: Tile): tile is Tile & Ownable {
  return 'ownerId' in tile;
}

/**
 * What a walk knows about itself, handed to every tile underfoot.
 *
 * One field, and it stays one field until a rule needs a second: a context that
 * accumulates whatever seemed handy is how `onLand` would have ended up with the
 * whole game in it, which is the thing `tile:effect` exists to avoid.
 *
 * `roll` is **null when the dice are not what moved you** — a card, a travel
 * voucher, a subway, a bonus move. That is not an "unknown"; it is a state the
 * printed rules have their own word for (*direct* movement), and the tiles that
 * care read it as one. Ultimate Monopoly's Pay Day pays its maximum for a direct
 * arrival, which is exactly `roll === null`.
 */
export interface PassContext {
  /** The dice total that produced this walk, or null if the dice did not. */
  roll: number | null;
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

  /**
   * Called for every tile a forward walk set foot on, **the landing tile
   * included** — see `Board.announcePassing`. `onPass` is what a tile charges
   * you for being there; `onLand` is what *else* happens when you stop.
   *
   * `ctx` is what the walk knows about itself, and deliberately nothing else: a
   * tile can see the roll that took a player past it, and cannot see the game.
   * Most tiles ignore it — an override may simply take `(playerId)` and
   * TypeScript is happy.
   */
  onPass(_playerId: string, _ctx: PassContext): void {}

  /**
   * Ownership is reported here rather than by each subclass. It used to be
   * `PropertyTile`'s alone, which meant a serialised board said nothing about
   * who held a railroad or a utility — invisible on the classic board, where the
   * playtest happens to trade a lot, and a silent hole on any board where a
   * railroad is the deed that changes hands.
   */
  toJSON(): object {
    const base = { id: this.id, type: this.type, name: this.name };
    return isOwnable(this)
      ? { ...base, ownerId: this.ownerId, isMortgaged: this.isMortgaged }
      : base;
  }
}
