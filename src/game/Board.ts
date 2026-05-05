import { BOARD_TILES, BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CORNER_SIZE, TILE_W } from '@/config';
import { Tile } from '@/tiles/Tile';
import { PropertyTile } from '@/tiles/PropertyTile';
import {
  RailroadTile, UtilityTile, TaxTile, CardTile,
  JailTile, GoToJailTile, GoTile, FreeParkingTile,
} from '@/tiles/SpecialTiles';

export interface TileLayout {
  x: number;
  y: number;
  rotation: number; // degrees, used for label rendering
  side: 'bottom' | 'left' | 'top' | 'right';
}

export class Board {
  readonly tiles: Tile[];
  private layoutCache: TileLayout[];

  constructor() {
    this.tiles = BOARD_TILES.map((def) => {
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
      }
    });
    this.layoutCache = this.computeLayout();
  }

  getTile(index: number): Tile {
    return this.tiles[index % 40];
  }

  getLayout(index: number): TileLayout {
    return this.layoutCache[index % 40];
  }

  /**
   * Returns the board index a player lands on after moving `steps` from `from`,
   * and flags whether they passed Go.
   */
  move(from: number, steps: number): { to: number; passedGo: boolean } {
    const to = (from + steps) % 40;
    const passedGo = from + steps >= 40;
    return { to, passedGo };
  }

  // ─── Layout math ─────────────────────────────────────────────────────────────
  // Board origin = top-left corner of the full board square.
  // Total board width = CORNER_SIZE * 2 + TILE_W * 9.
  private computeLayout(): TileLayout[] {
    const layouts: TileLayout[] = new Array(40);
    const boardW = CORNER_SIZE * 2 + TILE_W * 9;

    // Bottom row: tiles 0 (Go, right corner) → 10 (Jail, left corner), right-to-left
    for (let i = 0; i <= 10; i++) {
      let x: number;
      if (i === 0) {
        x = BOARD_ORIGIN_X + boardW - CORNER_SIZE / 2;        // right corner
      } else if (i === 10) {
        x = BOARD_ORIGIN_X + CORNER_SIZE / 2;                 // left corner
      } else {
        x = BOARD_ORIGIN_X + boardW - CORNER_SIZE - (i - 1) * TILE_W - TILE_W / 2;
      }
      layouts[i] = { x, y: BOARD_ORIGIN_Y + boardW - CORNER_SIZE / 2, rotation: 0, side: 'bottom' };
    }

    // Left column: tiles 11 → 19, bottom-to-top
    for (let i = 11; i <= 19; i++) {
      const y = BOARD_ORIGIN_Y + boardW - CORNER_SIZE - (i - 11) * TILE_W - TILE_W / 2;
      layouts[i] = { x: BOARD_ORIGIN_X + CORNER_SIZE / 2, y, rotation: 90, side: 'left' };
    }

    // Top row: tiles 20 (Free Parking) → 30 (Go to Jail), left-to-right
    for (let i = 20; i <= 30; i++) {
      let x: number;
      if (i === 20) {
        x = BOARD_ORIGIN_X + CORNER_SIZE / 2;                 // left corner
      } else if (i === 30) {
        x = BOARD_ORIGIN_X + boardW - CORNER_SIZE / 2;        // right corner
      } else {
        x = BOARD_ORIGIN_X + CORNER_SIZE + (i - 21) * TILE_W + TILE_W / 2;
      }
      layouts[i] = { x, y: BOARD_ORIGIN_Y + CORNER_SIZE / 2, rotation: 180, side: 'top' };
    }

    // Right column: tiles 31 → 39, top-to-bottom
    for (let i = 31; i <= 39; i++) {
      const y = BOARD_ORIGIN_Y + CORNER_SIZE + (i - 31) * TILE_W + TILE_W / 2;
      layouts[i] = { x: BOARD_ORIGIN_X + boardW - CORNER_SIZE / 2, y, rotation: 270, side: 'right' };
    }

    return layouts;
  }

  toJSON() {
    return { tiles: this.tiles.map((t) => t.toJSON()) };
  }
}
