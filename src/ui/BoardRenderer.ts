import Phaser from 'phaser';
import type { Board, TileLayout, BoardSide } from '@/game/Board';
import { GROUP_COLORS, BOARD_ORIGIN_X, BOARD_ORIGIN_Y } from '@/config';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';

// ─── BoardRenderer ────────────────────────────────────────────────────────────
// Everything drawn inside the board square. GameScene used to hold four
// near-identical loops here, one per side, which is what made adding owner
// markers and houses expensive. There is one loop now: each tile's footprint,
// orientation and band edges come from its TileLayout.
//
// The static layer (tile outlines, colour stripes, names) is drawn once. The
// state layer (owner bands, houses, hotels, mortgage marks) is cleared and
// redrawn by refresh(), which is cheap — 40 rectangles and a handful of sprites.

/** How the owner of a tile should be drawn, or null when the tile is unowned. */
export interface OwnerStyle {
  color: number;
  initial: string;
}

const BAND = 14;        // colour stripe on the board-interior edge
const OWNER_BAND = 7;   // owner marker on the board-rim edge

/** Which edge of a tile faces the middle of the board. */
const INNER_EDGE: Record<BoardSide, 'top' | 'bottom' | 'left' | 'right'> = {
  bottom: 'top', top: 'bottom', left: 'right', right: 'left',
};

const OPPOSITE: Record<'top' | 'bottom' | 'left' | 'right', 'top' | 'bottom' | 'left' | 'right'> = {
  top: 'bottom', bottom: 'top', left: 'right', right: 'left',
};

interface Band { x: number; y: number; w: number; h: number; vertical: boolean }

export class BoardRenderer {
  private scene: Phaser.Scene;
  private board: Board;
  private ownerStyle: (playerId: string) => OwnerStyle | null;

  private stateLayer!:  Phaser.GameObjects.Graphics;
  private selection!:   Phaser.GameObjects.Graphics;
  /** Building sprites and mortgage marks, rebuilt on every refresh. */
  private stateObjects: Phaser.GameObjects.GameObject[] = [];
  private selectedId: number | null = null;

  constructor(
    scene: Phaser.Scene,
    board: Board,
    ownerStyle: (playerId: string) => OwnerStyle | null,
  ) {
    this.scene      = scene;
    this.board      = board;
    this.ownerStyle = ownerStyle;
  }

  // ── Static layer ────────────────────────────────────────────────────────────

  /** Draw the board itself. Call once; nothing here changes during a game. */
  draw(onTileSelected: (tileId: number) => void): void {
    const g      = this.scene.add.graphics();
    const boardW = this.board.pixelSize;
    const left   = BOARD_ORIGIN_X;
    const top    = BOARD_ORIGIN_Y;

    g.fillStyle(0xd4e8c2, 1);
    g.fillRect(left, top, boardW, boardW);
    g.lineStyle(1, 0x555544, 1);

    for (let i = 0; i < this.board.size; i++) {
      const layout = this.board.getLayout(i);
      const tile   = this.board.getTile(i);

      g.strokeRect(layout.x - layout.w / 2, layout.y - layout.h / 2, layout.w, layout.h);

      if (tile instanceof PropertyTile) {
        const band = this.band(layout, INNER_EDGE[layout.side], BAND);
        g.fillStyle(GROUP_COLORS[tile.group], 1);
        g.fillRect(band.x, band.y, band.w, band.h);
      }

      // Nudge the label off the colour stripe on the two horizontal rows; the
      // columns have room to stay centred.
      const labelDy = layout.side === 'bottom' ? 4 : layout.side === 'top' ? -4 : 0;
      const wrapAt  = layout.side === 'bottom' || layout.side === 'top'
        ? layout.w - 4
        : layout.w - 18;

      this.scene.add.text(layout.x, layout.y + labelDy, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: wrapAt }, align: 'center',
      }).setOrigin(0.5, 0.5);

      this.scene.add.zone(layout.x, layout.y, layout.w, layout.h)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => onTileSelected(i));
    }

    const cx = left + boardW / 2;
    const cy = top + boardW / 2;
    this.scene.add.text(cx, cy - 20, '🏦', { fontSize: '48px' }).setOrigin(0.5);
    this.scene.add.text(cx, cy + 30, 'MONOPOLY\nFORGE', {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#222244',
      align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.stateLayer = this.scene.add.graphics().setDepth(2);
    this.selection  = this.scene.add.graphics().setDepth(4);
  }

  // ── State layer ─────────────────────────────────────────────────────────────

  /** Redraw owner bands, buildings and mortgage marks from current tile state. */
  refresh(): void {
    this.stateLayer.clear();
    this.stateObjects.forEach((o) => o.destroy());
    this.stateObjects = [];

    for (let i = 0; i < this.board.size; i++) {
      const tile   = this.board.getTile(i);
      const layout = this.board.getLayout(i);
      if (!isOwnable(tile) || tile.ownerId === null) continue;

      const style = this.ownerStyle(tile.ownerId);
      if (!style) continue;

      // Owner band on the rim edge — the group stripe already owns the inner one.
      const band = this.band(layout, OPPOSITE[INNER_EDGE[layout.side]], OWNER_BAND);
      this.stateLayer.fillStyle(style.color, tile.isMortgaged ? 0.35 : 1);
      this.stateLayer.fillRect(band.x, band.y, band.w, band.h);
      this.stateLayer.lineStyle(1, 0x000000, 0.5);
      this.stateLayer.strokeRect(band.x, band.y, band.w, band.h);

      this.stateObjects.push(
        this.scene.add.text(band.x + band.w / 2, band.y + band.h / 2, style.initial, {
          fontFamily: 'Arial', fontSize: '7px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(3),
      );

      if (tile.isMortgaged) {
        this.stateObjects.push(
          this.scene.add.text(layout.x, layout.y, 'M', {
            fontFamily: 'Arial', fontSize: '13px', color: '#cc2222', fontStyle: 'bold',
          }).setOrigin(0.5).setDepth(3).setAlpha(0.85),
        );
      }

      if (tile instanceof PropertyTile) this.drawBuildings(tile, layout);
    }
  }

  /** Ring the given tile, or clear the ring when passed null. */
  setSelected(tileId: number | null): void {
    this.selectedId = tileId;
    this.selection.clear();
    if (tileId === null) return;

    const layout = this.board.getLayout(tileId);
    this.selection.lineStyle(2.5, 0xf0c040, 1);
    this.selection.strokeRect(
      layout.x - layout.w / 2 + 1, layout.y - layout.h / 2 + 1,
      layout.w - 2, layout.h - 2,
    );
  }

  get selected(): number | null {
    return this.selectedId;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Houses sit along the colour stripe, a hotel replaces all four. */
  private drawBuildings(tile: PropertyTile, layout: TileLayout): void {
    if (!tile.hasHotel && tile.houses === 0) return;

    const band = this.band(layout, INNER_EDGE[layout.side], BAND);
    const cx   = band.x + band.w / 2;
    const cy   = band.y + band.h / 2;

    if (tile.hasHotel) {
      this.stateObjects.push(
        this.scene.add.image(cx, cy, 'hotel').setScale(0.6).setDepth(3),
      );
      return;
    }

    // Four slots along the band's long axis, whichever way it runs.
    const span = band.vertical ? band.h : band.w;
    for (let k = 0; k < tile.houses; k++) {
      const offset = (k + 0.5) * (span / 4) - span / 2;
      this.stateObjects.push(
        this.scene.add.image(
          band.vertical ? cx : cx + offset,
          band.vertical ? cy + offset : cy,
          'house',
        ).setScale(0.5).setDepth(3),
      );
    }
  }

  /** A strip of `thickness` px along one edge of a tile. */
  private band(layout: TileLayout, edge: 'top' | 'bottom' | 'left' | 'right', thickness: number): Band {
    const l = layout.x - layout.w / 2;
    const t = layout.y - layout.h / 2;
    switch (edge) {
      case 'top':    return { x: l, y: t, w: layout.w, h: thickness, vertical: false };
      case 'bottom': return { x: l, y: t + layout.h - thickness, w: layout.w, h: thickness, vertical: false };
      case 'left':   return { x: l, y: t, w: thickness, h: layout.h, vertical: true };
      case 'right':  return { x: l + layout.w - thickness, y: t, w: thickness, h: layout.h, vertical: true };
    }
  }
}
