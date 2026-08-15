import Phaser from 'phaser';
import type { Board, TileLayout } from '@/game/Board';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import { standingOn } from '@/game/BuildLadder';
import { theme } from './Theme';
import { decorationFor, GROUP_BAND } from './TileDecor';

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

/** Colour stripe on the board-interior edge. Owned by `TileDecor`, which draws it. */
const BAND = GROUP_BAND;
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
  /** Tiles a board-style choice will accept — see `setChoosable`. */
  private choosable: number[] = [];
  /** Everything the static layer put on screen, so `redraw` can take it down. */
  private staticObjects: Phaser.GameObjects.GameObject[] = [];
  /** Kept so a redraw can re-register the click zones it destroys. */
  private onTileSelected: ((tileId: number) => void) | null = null;

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

  /**
   * Draw the board itself. Nothing here changes *during* a game — but the
   * palette can, so everything this creates is kept and `redraw` takes it down
   * again. None of it was tracked before M10b, which is the whole reason a theme
   * could only be chosen before a game started.
   */
  draw(onTileSelected: (tileId: number) => void): void {
    const t = theme();
    this.onTileSelected = onTileSelected;
    const g = this.scene.add.graphics();
    this.staticObjects.push(g);
    this.drawBackdrop(g);
    g.lineStyle(1, t.board.tileOutline, 1);

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

      // What goes *inside* the outline is the tile type's own business — a lot's
      // colour band, a railroad's glyph, whatever a game registered. See TileDecor.
      decorationFor(tile.type)({
        scene: this.scene, g, tile, layout, theme: t,
        // Tracked like everything else static: a decoration that writes on a
        // tile has to come down with the rest when the palette changes.
        label: (lx, ly, text, style) => {
          const drawn = this.label(layout, lx, ly, text, style);
          this.staticObjects.push(drawn);
          return drawn;
        },
      });
      g.restore();

      // Text cannot be drawn into that frame, so it is placed and turned to match.
      this.staticObjects.push(this.label(layout, 0, BAND / 2, tile.name, {
        fontFamily: t.font.body, fontSize: '6px', color: t.board.tileLabel,
        wordWrap: { width: layout.w - 4 }, align: 'center',
      }));

      this.staticObjects.push(
        this.scene.add.zone(layout.x, layout.y, layout.w, layout.h)
          .setRotation(Phaser.Math.DegToRad(layout.rotation))
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => onTileSelected(i)),
      );
    }

    const { x: cx, y: cy } = this.board.centre;
    this.staticObjects.push(
      this.scene.add.text(cx, cy - 20, t.board.emblem, { fontSize: '48px' }).setOrigin(0.5),
      this.scene.add.text(cx, cy + 30, 'MONOPOLY\nFORGE', {
        fontFamily: t.font.display, fontSize: '20px', color: t.board.centreTitle,
        align: 'center', fontStyle: 'bold',
      }).setOrigin(0.5),
    );

    this.stateLayer = this.scene.add.graphics().setDepth(2);
    this.selection  = this.scene.add.graphics().setDepth(4);
  }

  /**
   * Draw it all again in whatever palette is current — the board's half of a
   * theme changed mid-game.
   *
   * Everything static goes, the click zones included, and is rebuilt: a zone
   * that survived would sit under the new one and fire the handler twice. The
   * selection and the choosable ring are re-applied rather than dropped,
   * because a change of colour is not a reason to lose what was highlighted.
   */
  redraw(): void {
    if (!this.onTileSelected) return;
    const selected  = this.selectedId;
    const choosable = [...this.choosable];

    for (const object of this.staticObjects) object.destroy();
    this.staticObjects = [];
    for (const object of this.stateObjects) object.destroy();
    this.stateObjects = [];
    this.stateLayer?.destroy();
    this.selection?.destroy();

    this.draw(this.onTileSelected);
    this.refresh();
    this.choosable = choosable;
    this.setSelected(selected);
  }

  /**
   * Text at a point in a tile's own frame, turned to match it and never printed
   * upside down. Every label on the board goes through here — the tile's name,
   * an owner's seat number, whatever a decoration wants to write.
   */
  private label(
    layout: TileLayout, localX: number, localY: number,
    text: string, style: Phaser.Types.GameObjects.Text.TextStyle,
  ): Phaser.GameObjects.Text {
    const at = this.toWorld(layout, localX, localY);
    return this.scene.add.text(at.x, at.y, text, style)
      .setOrigin(0.5, 0.5)
      .setRotation(Phaser.Math.DegToRad(readableAngle(layout.rotation)));
  }

  private drawBackdrop(g: Phaser.GameObjects.Graphics): void {
    const backdrop = this.board.backdrop;
    g.fillStyle(theme().board.backdrop, 1);
    if (backdrop.kind === 'circle') {
      g.fillCircle(backdrop.x, backdrop.y, backdrop.size);
    } else {
      g.fillRect(backdrop.x, backdrop.y, backdrop.size, backdrop.size);
    }
  }

  // ── State layer ─────────────────────────────────────────────────────────────

  /** Redraw owner bands, buildings and mortgage marks from current tile state. */
  refresh(): void {
    const t = theme();
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

      this.stateObjects.push(
        this.label(layout, 0, half.h - OWNER_BAND / 2, style.initial, {
          fontFamily: t.font.body, fontSize: '7px',
          color: t.board.ownerBadge, fontStyle: 'bold',
        }).setDepth(3),
      );

      if (tile.isMortgaged) {
        this.stateObjects.push(
          this.scene.add.text(layout.x, layout.y, 'M', {
            fontFamily: t.font.body, fontSize: '13px',
            color: t.board.mortgageMark, fontStyle: 'bold',
          }).setOrigin(0.5).setDepth(3).setAlpha(0.85),
        );
      }

      // Any ownable tile, not only a lot: a train depot stands on a railroad.
      if (isOwnable(tile)) this.drawBuildings(tile, layout);
    }
  }

  /** Ring the given tile, or clear the ring when passed null. */
  /**
   * Ring the tiles a board-style choice will accept. Drawn on the same layer as
   * the selection, and cleared by it — the two are never wanted at once, because
   * while a choice is open the board *is* the prompt rather than the inspector.
   */
  setChoosable(tileIds: number[]): void {
    this.choosable = tileIds;
    this.setSelected(this.selectedId);
  }

  setSelected(tileId: number | null): void {
    this.selectedId = tileId;
    this.selection.clear();

    for (const id of this.choosable) {
      const layout = this.board.getLayout(id);
      this.selection.save();
      this.selection.translateCanvas(layout.x, layout.y);
      this.selection.rotateCanvas(Phaser.Math.DegToRad(layout.rotation));
      this.selection.lineStyle(3, theme().board.selection, 0.9);
      this.selection.strokeRect(
        -layout.w / 2 + 1, -layout.h / 2 + 1, layout.w - 2, layout.h - 2,
      );
      this.selection.restore();
    }

    if (tileId === null) return;

    const layout = this.board.getLayout(tileId);
    this.selection.save();
    this.selection.translateCanvas(layout.x, layout.y);
    this.selection.rotateCanvas(Phaser.Math.DegToRad(layout.rotation));
    this.selection.lineStyle(2.5, theme().board.selection, 1);
    this.selection.strokeRect(
      -layout.w / 2 + 1, -layout.h / 2 + 1, layout.w - 2, layout.h - 2,
    );
    this.selection.restore();
  }

  get selected(): number | null {
    return this.selectedId;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /**
   * Whatever is standing there, along the colour stripe. Four houses spread
   * across the tile; one of anything bigger sits in the middle.
   *
   * It asks the ladder rather than testing `hasHotel`, so a board that builds
   * skyscrapers or train depots draws them without this method learning their
   * names — the texture key *is* the level's id, which is the same bargain
   * `Game.assets` already makes with `house` and `hotel`.
   */
  private drawBuildings(tile: Tile & Ownable, layout: TileLayout): void {
    const standing = standingOn(this.board.rules.buildLadder, tile.type, tile.level);
    if (!standing) return;
    if (!this.scene.textures.exists(standing.kind.id)) return;

    const angle = Phaser.Math.DegToRad(layout.rotation);
    const stripe = -layout.h / 2 + BAND / 2;   // middle of the colour band, locally

    // One of something big goes in the middle; a row of small ones spreads out.
    if (standing.count === 1 && standing.kind.perTile === 1) {
      const at = this.toWorld(layout, 0, stripe);
      this.stateObjects.push(
        this.scene.add.image(at.x, at.y, standing.kind.id)
          .setScale(0.6).setRotation(angle).setDepth(3),
      );
      return;
    }

    const slots = standing.kind.perTile;
    for (let k = 0; k < standing.count; k++) {
      const offset = (k + 0.5) * (layout.w / slots) - layout.w / 2;
      const at = this.toWorld(layout, offset, stripe);
      this.stateObjects.push(
        this.scene.add.image(at.x, at.y, standing.kind.id)
          .setScale(0.5).setRotation(angle).setDepth(3),
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
