import Phaser from 'phaser';
import type { Board, TileLayout } from '@/game/Board';
import { GROUP_COLORS } from '@/config';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';

// ─── BoardRenderer ────────────────────────────────────────────────────────────
// Everything drawn inside the board. GameScene used to hold four near-identical
// loops here, one per side of a square; then one loop that still assumed the four
// sides were axis-aligned. Neither could draw a circle.
//
// Now every tile is drawn **in its own frame**: translate to the tile's centre,
// rotate by its angle, and lay the rectangle out around the origin with the
// board's interior past the top edge. A tile on the bottom row is that frame
// unrotated; one on the left column is turned 90°; one on a ring is turned to
// whatever angle points it at the centre. One code path covers all of them.
//
// The static layer (outlines, colour stripes, names) is drawn once. The state
// layer (owner bands, houses, hotels, mortgage marks) is cleared and redrawn by
// refresh() after anything that changes tile state.

/** How the owner of a tile should be drawn, or null when the tile is unowned. */
export interface OwnerStyle {
  color: number;
  initial: string;
}

const BAND = 14;        // colour stripe on the board-interior edge
const OWNER_BAND = 7;   // owner marker on the board-rim edge

/**
 * A label follows its tile — it has to, on a board where the tiles face every
 * direction — but it is never printed upside down. A tile turned to face away
 * gets its text spun the other half turn, so the far side of the board reads as
 * easily as the near side.
 */
function readableAngle(rotation: number): number {
  const turned = ((rotation % 360) + 360) % 360;
  return turned > 90 && turned < 270 ? turned - 180 : turned;
}

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
    const g = this.scene.add.graphics();
    this.drawBackdrop(g);
    g.lineStyle(1, 0x555544, 1);

    for (let i = 0; i < this.board.size; i++) {
      const layout = this.board.getLayout(i);
      const tile   = this.board.getTile(i);
      const half   = { w: layout.w / 2, h: layout.h / 2 };

      // Everything inside save/restore is drawn as if the tile were unrotated at
      // the origin, with the board's middle beyond its top edge.
      g.save();
      g.translateCanvas(layout.x, layout.y);
      g.rotateCanvas(Phaser.Math.DegToRad(layout.rotation));

      g.strokeRect(-half.w, -half.h, layout.w, layout.h);
      if (tile instanceof PropertyTile) {
        g.fillStyle(GROUP_COLORS[tile.group], 1);
        g.fillRect(-half.w, -half.h, layout.w, BAND);
      }
      g.restore();

      // Text cannot be drawn into that frame, so it is placed and turned to match.
      const label = this.scene.add.text(0, 0, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: layout.w - 4 }, align: 'center',
      }).setOrigin(0.5, 0.5).setRotation(Phaser.Math.DegToRad(readableAngle(layout.rotation)));
      // Nudged clear of the colour stripe, in the tile's own frame.
      const nudged = this.toWorld(layout, 0, BAND / 2);
      label.setPosition(nudged.x, nudged.y);

      this.scene.add.zone(layout.x, layout.y, layout.w, layout.h)
        .setRotation(Phaser.Math.DegToRad(layout.rotation))
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => onTileSelected(i));
    }

    const { x: cx, y: cy } = this.board.centre;
    this.scene.add.text(cx, cy - 20, '🏦', { fontSize: '48px' }).setOrigin(0.5);
    this.scene.add.text(cx, cy + 30, 'MONOPOLY\nFORGE', {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#222244',
      align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.stateLayer = this.scene.add.graphics().setDepth(2);
    this.selection  = this.scene.add.graphics().setDepth(4);
  }

  private drawBackdrop(g: Phaser.GameObjects.Graphics): void {
    const backdrop = this.board.backdrop;
    g.fillStyle(0xd4e8c2, 1);
    if (backdrop.kind === 'circle') {
      g.fillCircle(backdrop.x, backdrop.y, backdrop.size);
    } else {
      g.fillRect(backdrop.x, backdrop.y, backdrop.size, backdrop.size);
    }
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

      const half = { w: layout.w / 2, h: layout.h / 2 };

      // Owner band along the rim edge — the group stripe already owns the inner one.
      this.stateLayer.save();
      this.stateLayer.translateCanvas(layout.x, layout.y);
      this.stateLayer.rotateCanvas(Phaser.Math.DegToRad(layout.rotation));
      this.stateLayer.fillStyle(style.color, tile.isMortgaged ? 0.35 : 1);
      this.stateLayer.fillRect(-half.w, half.h - OWNER_BAND, layout.w, OWNER_BAND);
      this.stateLayer.lineStyle(1, 0x000000, 0.5);
      this.stateLayer.strokeRect(-half.w, half.h - OWNER_BAND, layout.w, OWNER_BAND);
      this.stateLayer.restore();

      const badge = this.toWorld(layout, 0, half.h - OWNER_BAND / 2);
      this.stateObjects.push(
        this.scene.add.text(badge.x, badge.y, style.initial, {
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
    this.selection.save();
    this.selection.translateCanvas(layout.x, layout.y);
    this.selection.rotateCanvas(Phaser.Math.DegToRad(layout.rotation));
    this.selection.lineStyle(2.5, 0xf0c040, 1);
    this.selection.strokeRect(
      -layout.w / 2 + 1, -layout.h / 2 + 1, layout.w - 2, layout.h - 2,
    );
    this.selection.restore();
  }

  get selected(): number | null {
    return this.selectedId;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Houses sit along the colour stripe, a hotel replaces all four. */
  private drawBuildings(tile: PropertyTile, layout: TileLayout): void {
    if (!tile.hasHotel && tile.houses === 0) return;

    const angle = Phaser.Math.DegToRad(layout.rotation);
    const stripe = -layout.h / 2 + BAND / 2;   // middle of the colour band, locally

    if (tile.hasHotel) {
      const at = this.toWorld(layout, 0, stripe);
      this.stateObjects.push(
        this.scene.add.image(at.x, at.y, 'hotel').setScale(0.6).setRotation(angle).setDepth(3),
      );
      return;
    }

    // Four slots along the stripe, however the tile happens to be turned.
    for (let k = 0; k < tile.houses; k++) {
      const offset = (k + 0.5) * (layout.w / 4) - layout.w / 2;
      const at = this.toWorld(layout, offset, stripe);
      this.stateObjects.push(
        this.scene.add.image(at.x, at.y, 'house').setScale(0.5).setRotation(angle).setDepth(3),
      );
    }
  }

  /** A point in a tile's own frame, in world coordinates. */
  private toWorld(layout: TileLayout, localX: number, localY: number): { x: number; y: number } {
    const angle = Phaser.Math.DegToRad(layout.rotation);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: layout.x + localX * cos - localY * sin,
      y: layout.y + localX * sin + localY * cos,
    };
  }
}
