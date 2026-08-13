import { Tile, type TileDefinition } from '@/tiles/Tile';
import { CLASSIC_MAP } from '@/maps/classic';
import type { GameMap } from '@/maps/GameMap';
import {
  computeGeometry, type BoardGeometry, type Backdrop, type TileLayout,
} from './BoardLayout';
import { PropertyTile } from '@/tiles/PropertyTile';
import {
  RailroadTile, UtilityTile, TaxTile, CardTile,
  JailTile, GoToJailTile, GoTile, FreeParkingTile,
} from '@/tiles/SpecialTiles';

export type { BoardSide, TileLayout, Backdrop, LayoutSpec } from './BoardLayout';

/**
 * The roles the rules ask for by name instead of by index. A map declares which
 * tile plays each part; nothing in the model should hardcode "jail is tile 10".
 */
export type BoardAnchor = 'start' | 'jail' | 'goToJail';

const ANCHOR_OF_TYPE: Partial<Record<Tile['type'], BoardAnchor>> = {
  go:       'start',
  jail:     'jail',
  goToJail: 'goToJail',
};

export class Board {
  readonly tiles: Tile[];
  /** Number of tiles in a full circuit — every wrap-around goes through this. */
  readonly size: number;
  /** The map this board was built from, including the shape it is drawn in. */
  readonly map: GameMap;
  private geometry: BoardGeometry;
  private anchors: Map<BoardAnchor, number>;

  /**
   * Takes a map, or a bare tile list for the tests that only care about the
   * circuit. A bare list is laid out as a square, which is what it used to be.
   */
  constructor(source: GameMap | TileDefinition[] = CLASSIC_MAP) {
    this.map = Array.isArray(source)
      ? { ...CLASSIC_MAP, id: 'inline', name: 'Inline', tiles: source }
      : source;

    this.tiles = this.map.tiles.map((def) => {
      switch (def.type) {
        case 'property':      return new PropertyTile(def);
        case 'railroad':      return new RailroadTile(def);
        case 'utility':       return new UtilityTile(def);
        case 'tax':           return new TaxTile(def);
        case 'chance':        return new CardTile(def);
        case 'communityChest':return new CardTile(def);
        case 'jail':          return new JailTile(def);
        case 'goToJail':      return new GoToJailTile(def);
        case 'go':            return new GoTile(def);
        case 'freeParking':   return new FreeParkingTile(def);
        default:
          throw new Error(
            `[Board] Unknown tile type "${(def as { type: string }).type}" for id ${def.id}`,
          );
      }
    });
    this.size     = this.tiles.length;
    this.anchors  = this.resolveAnchors();
    this.geometry = computeGeometry(this.map.layout, this.size);
  }

  getTile(index: number): Tile {
    if (!Number.isFinite(index)) {
      throw new Error(`[Board] getTile: non-finite index ${index}`);
    }
    const i = Math.floor(index) % this.size;
    const tile = this.tiles[i];
    if (tile === undefined) {
      throw new Error(`[Board] getTile(${index}): slot ${i} is undefined (tiles.length=${this.tiles.length})`);
    }
    return tile;
  }

  getLayout(index: number): TileLayout {
    if (!Number.isFinite(index)) {
      throw new Error(`[Board] getLayout: non-finite index ${index}`);
    }
    const i = Math.floor(index) % this.size;
    const layout = this.geometry.tiles[i];
    if (layout === undefined) {
      throw new Error(`[Board] getLayout(${index}): slot ${i} is undefined`);
    }
    return layout;
  }

  move(from: number, steps: number): { to: number; passedGo: boolean } {
    if (!Number.isFinite(from) || !Number.isFinite(steps)) {
      throw new Error(`[Board] move() non-finite: from=${from}, steps=${steps}`);
    }
    const f = Math.floor(from);
    const s = Math.floor(steps);
    // Use positive-modulo so negatives never leak through (JS % preserves sign).
    const to = ((f + s) % this.size + this.size) % this.size;
    return { to, passedGo: f + s >= this.size };
  }

  /** Distance travelled going forwards from `from` to `to`, always 0…size-1. */
  stepsBetween(from: number, to: number): number {
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new Error(`[Board] stepsBetween() non-finite: from=${from}, to=${to}`);
    }
    return ((Math.floor(to) - Math.floor(from)) % this.size + this.size) % this.size;
  }

  // ─── Anchors ─────────────────────────────────────────────────────────────────

  /** Index of the tile playing `role`. Throws — a map without a jail cannot jail. */
  anchor(role: BoardAnchor): number {
    const index = this.anchors.get(role);
    if (index === undefined) {
      throw new Error(`[Board] no tile plays the "${role}" role on this map`);
    }
    return index;
  }

  tryAnchor(role: BoardAnchor): number | null {
    return this.anchors.get(role) ?? null;
  }

  /** Every property tile in a colour group, in board order. */
  groupTiles(group: string): PropertyTile[] {
    return this.tiles.filter(
      (t): t is PropertyTile => t instanceof PropertyTile && t.group === group,
    );
  }

  private resolveAnchors(): Map<BoardAnchor, number> {
    const found = new Map<BoardAnchor, number>();
    this.tiles.forEach((tile, i) => {
      const role = ANCHOR_OF_TYPE[tile.type];
      if (role !== undefined && !found.has(role)) found.set(role, i);
    });
    return found;
  }

  // ─── Geometry ────────────────────────────────────────────────────────────────
  // Where the tiles sit is the map's business, not the board's: see
  // game/BoardLayout.ts. The board only forwards the answers.

  /** The board's own outline — a square, a circle, whatever the map asked for. */
  get backdrop(): Backdrop {
    return this.geometry.backdrop;
  }

  /** Middle of the board, for the centrepiece and anything drawn inside it. */
  get centre(): { x: number; y: number } {
    return this.geometry.centre;
  }

  toJSON() {
    return { tiles: this.tiles.map((t) => t.toJSON()) };
  }
}
