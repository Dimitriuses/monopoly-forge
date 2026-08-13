import Phaser from 'phaser';
import { PropertyTile } from '@/tiles/PropertyTile';
import type { Theme } from './Theme';
import type { Tile } from '@/tiles/Tile';
import type { TileLayout } from '@/game/BoardLayout';

// ─── TileDecor ────────────────────────────────────────────────────────────────
// How one *kind* of tile draws, as a registry rather than a branch inside the
// renderer. `BoardRenderer` used to know that a property has a colour stripe and
// that nothing else has anything, which meant a game adding a tile type got a
// rectangle with a name in it and no way to say otherwise short of forking the
// renderer.
//
// A decoration is handed the tile's **own frame**: the origin is the middle of
// the tile, `-h/2` is the edge facing the board's interior, and everything is
// already rotated. That is the whole reason the geometry work in 8a insisted on
// tiles being rectangles in their own frames — a decoration written once is
// right on a square board, a circle and a three-ring spiral.
//
// Text cannot be drawn into a rotated Graphics frame, so `ctx.label()` places a
// Text object at a point in that frame and turns it to match, keeping it the
// right way up. Anything it returns is owned by the caller and destroyed with
// the rest of the static layer.

export interface DecorContext {
  scene: Phaser.Scene;
  /** The static layer, already translated and rotated into the tile's frame. */
  g: Phaser.GameObjects.Graphics;
  tile: Tile;
  layout: TileLayout;
  theme: Theme;
  /** Place text at a point in the tile's frame, turned to match and readable. */
  label(localX: number, localY: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text;
}

export interface TileDecoration {
  (ctx: DecorContext): void;
}

const DECORATIONS = new Map<string, TileDecoration>();

/** Teach the renderer how a tile type draws. Registering over a name replaces it. */
export function registerTileDecoration(type: string, decoration: TileDecoration): void {
  DECORATIONS.set(type, decoration);
}

export function knownTileDecorations(): string[] {
  return [...DECORATIONS.keys()];
}

/**
 * The decoration for a tile type, or the fallback. A type nobody has decorated
 * still draws — an outline and its name — because a board that renders a new
 * tile kind as a blank rectangle is far better than one that refuses to draw.
 */
export function decorationFor(type: string): TileDecoration {
  return DECORATIONS.get(type) ?? NO_DECORATION;
}

const NO_DECORATION: TileDecoration = () => {};

// ─── The built-ins ────────────────────────────────────────────────────────────

/** The colour stripe every lot carries along its inner edge. */
export const GROUP_BAND = 14;

registerTileDecoration('property', ({ g, tile, layout, theme: t }) => {
  if (!(tile instanceof PropertyTile)) return;
  g.fillStyle(t.groups[tile.group], 1);
  g.fillRect(-layout.w / 2, -layout.h / 2, layout.w, GROUP_BAND);
});

/**
 * Everything else gets a glyph where a lot has its stripe. The classic board
 * names these tiles and nothing more, which reads as a wall of small text; a
 * mark in the same place the colour would be tells them apart at a glance.
 */
const GLYPHS: Record<string, string> = {
  go:             '➜',
  railroad:       '🚂',
  utility:        '💡',
  tax:            '💸',
  chance:         '❓',
  communityChest: '🎁',
  jail:           '🔒',
  freeParking:    '🅿',
  goToJail:       '🚔',
};

for (const [type, glyph] of Object.entries(GLYPHS)) {
  registerTileDecoration(type, ({ label, layout }) => {
    // On the inner edge, where a lot's colour band sits, so the two kinds of
    // tile line up with each other whatever shape the board is.
    label(0, -layout.h / 2 + GROUP_BAND / 2, glyph, { fontSize: '9px' });
  });
}
