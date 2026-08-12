import { BOARD_TILES, BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CORNER_SIZE, TILE_W, TILE_H } from '@/config';
import { Tile, type TileDefinition } from '@/tiles/Tile';
import { PropertyTile } from '@/tiles/PropertyTile';
import {
  RailroadTile, UtilityTile, TaxTile, CardTile,
  JailTile, GoToJailTile, GoTile, FreeParkingTile,
} from '@/tiles/SpecialTiles';

export type BoardSide = 'bottom' | 'left' | 'top' | 'right';

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

export interface TileLayout {
  x: number;
  y: number;
  rotation: number; // degrees, used for label rendering
  side: BoardSide;
  /** Drawn footprint, already oriented for the side the tile sits on. */
  w: number;
  h: number;
  isCorner: boolean;
}

export class Board {
  readonly tiles: Tile[];
  /** Number of tiles in a full circuit — every wrap-around goes through this. */
  readonly size: number;
  private layoutCache: TileLayout[];
  private anchors: Map<BoardAnchor, number>;

  constructor(definitions: TileDefinition[] = BOARD_TILES) {
    this.tiles = definitions.map((def) => {
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
    this.size        = this.tiles.length;
    this.anchors     = this.resolveAnchors();
    this.layoutCache = this.computeLayout();
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
    const layout = this.layoutCache[i];
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

  // ─── Layout math ─────────────────────────────────────────────────────────────
  // Board origin = top-left corner of the full board square. The four corners sit
  // at even fractions of the circuit, so everything below is derived from
  // `perSide` rather than from the classic 0–10 / 11–19 / 20–30 / 31–39 ranges.
  //
  // Corners belong to the row they are drawn in: the bottom row runs corner →
  // mid tiles → corner, and the columns hold only mid tiles.
  private computeLayout(): TileLayout[] {
    const perSide = (this.size - 4) / 4;
    if (!Number.isInteger(perSide) || perSide < 0) {
      throw new Error(
        `[Board] the square layout needs four corners and equal sides — ` +
        `${this.size} tiles leaves ${perSide} per side`,
      );
    }

    // First index of each side, walking anticlockwise from Go in the bottom-right.
    const [c0, c1, c2, c3] = [0, 1, 2, 3].map((k) => k * (perSide + 1));
    const boardW = CORNER_SIZE * 2 + TILE_W * perSide;
    const right  = BOARD_ORIGIN_X + boardW;
    const bottom = BOARD_ORIGIN_Y + boardW;

    const corner = (x: number, y: number, side: BoardSide, rotation: number): TileLayout =>
      ({ x, y, rotation, side, w: CORNER_SIZE, h: CORNER_SIZE, isCorner: true });

    const layouts: TileLayout[] = new Array(this.size);

    for (let i = 0; i < this.size; i++) {
      if (i === c0) {
        layouts[i] = corner(right - CORNER_SIZE / 2, bottom - CORNER_SIZE / 2, 'bottom', 0);
      } else if (i === c1) {
        layouts[i] = corner(BOARD_ORIGIN_X + CORNER_SIZE / 2, bottom - CORNER_SIZE / 2, 'bottom', 0);
      } else if (i === c2) {
        layouts[i] = corner(BOARD_ORIGIN_X + CORNER_SIZE / 2, BOARD_ORIGIN_Y + CORNER_SIZE / 2, 'top', 180);
      } else if (i === c3) {
        layouts[i] = corner(right - CORNER_SIZE / 2, BOARD_ORIGIN_Y + CORNER_SIZE / 2, 'top', 180);
      } else if (i < c1) {
        // Bottom row, right-to-left
        const k = i - c0 - 1;
        layouts[i] = {
          x: right - CORNER_SIZE - k * TILE_W - TILE_W / 2, y: bottom - CORNER_SIZE / 2,
          rotation: 0, side: 'bottom', w: TILE_W, h: TILE_H, isCorner: false,
        };
      } else if (i < c2) {
        // Left column, bottom-to-top
        const k = i - c1 - 1;
        layouts[i] = {
          x: BOARD_ORIGIN_X + CORNER_SIZE / 2, y: bottom - CORNER_SIZE - k * TILE_W - TILE_W / 2,
          rotation: 90, side: 'left', w: TILE_H, h: TILE_W, isCorner: false,
        };
      } else if (i < c3) {
        // Top row, left-to-right
        const k = i - c2 - 1;
        layouts[i] = {
          x: BOARD_ORIGIN_X + CORNER_SIZE + k * TILE_W + TILE_W / 2, y: BOARD_ORIGIN_Y + CORNER_SIZE / 2,
          rotation: 180, side: 'top', w: TILE_W, h: TILE_H, isCorner: false,
        };
      } else {
        // Right column, top-to-bottom
        const k = i - c3 - 1;
        layouts[i] = {
          x: right - CORNER_SIZE / 2, y: BOARD_ORIGIN_Y + CORNER_SIZE + k * TILE_W + TILE_W / 2,
          rotation: 270, side: 'right', w: TILE_H, h: TILE_W, isCorner: false,
        };
      }
    }

    return layouts;
  }

  /** Outer dimension of the drawn board square, in pixels. */
  get pixelSize(): number {
    return CORNER_SIZE * 2 + TILE_W * ((this.size - 4) / 4);
  }

  toJSON() {
    return { tiles: this.tiles.map((t) => t.toJSON()) };
  }
}
