import { BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CORNER_SIZE, TILE_W, TILE_H } from '@/config';

// ─── BoardLayout ──────────────────────────────────────────────────────────────
// Where the tiles go. A map declares the *shape* it wants and this works out the
// coordinates; nothing here knows what a tile does, and nothing that knows what a
// tile does needs to know where it is drawn.
//
// The one idea that makes non-square boards possible: **every tile is a rectangle
// in its own frame, and the edge facing the middle of the board is its local
// top.** A tile on the bottom row is drawn unrotated; one on the left column is
// the same rectangle turned 90°; one on a ring is turned to whatever angle points
// it at the centre. The renderer draws every tile the same way and lets the
// rotation do the work, instead of holding one branch per side of a square.

export type BoardSide = 'bottom' | 'left' | 'top' | 'right';

export interface TileLayout {
  x: number;
  y: number;
  /** Degrees clockwise. The board's interior lies past the tile's local top edge. */
  rotation: number;
  /** Local footprint: `w` across the tile, `h` from the rim inward. */
  w: number;
  h: number;
  isCorner: boolean;
  /** Which side of a square board this is, or null on a shape that has no sides. */
  side: BoardSide | null;
}

/** The board's own outline, drawn under the tiles. */
export interface Backdrop {
  kind: 'square' | 'circle';
  /** Top-left for a square, centre for a circle. */
  x: number;
  y: number;
  /** Side length for a square, radius for a circle. */
  size: number;
}

export interface BoardGeometry {
  tiles: TileLayout[];
  backdrop: Backdrop;
  centre: { x: number; y: number };
}

/**
 * What shape a map wants to be laid out as.
 *
 * - `square` — the classic board: four corners and equal sides. Needs `4n + 4`
 *   tiles, and says so rather than mis-drawing anything else.
 * - `ring` — one circle of evenly spaced tiles, any count.
 * - `rings` — concentric circles, tiles dealt to each in order. The circuit still
 *   runs 0 → n-1 → 0; a ring is a way of arranging it, not a second loop.
 */
export type LayoutSpec =
  | { kind: 'square' }
  | { kind: 'ring'; depth?: number }
  | { kind: 'rings'; rings: RingSpec[]; depth?: number };

export interface RingSpec {
  count: number;
  /** Distance from the board's centre to the middle of the tile. */
  radius: number;
}

/** The square the board is drawn inside, whatever shape it actually takes. */
const AREA = { x: BOARD_ORIGIN_X, y: BOARD_ORIGIN_Y, size: CORNER_SIZE * 2 + TILE_W * 9 };
const RING_DEPTH = 64;

export function computeGeometry(spec: LayoutSpec, tileCount: number): BoardGeometry {
  switch (spec.kind) {
    case 'square': return squareGeometry(tileCount);
    case 'ring':   return ringsGeometry(
      [{ count: tileCount, radius: AREA.size / 2 - (spec.depth ?? RING_DEPTH) / 2 - 4 }],
      spec.depth ?? RING_DEPTH, tileCount,
    );
    case 'rings':  return ringsGeometry(spec.rings, spec.depth ?? RING_DEPTH, tileCount);
  }
}

// ─── Square ───────────────────────────────────────────────────────────────────

function squareGeometry(tileCount: number): BoardGeometry {
  const perSide = (tileCount - 4) / 4;
  if (!Number.isInteger(perSide) || perSide < 0) {
    throw new Error(
      `[BoardLayout] a square board needs four corners and equal sides — ` +
      `${tileCount} tiles leaves ${perSide} per side`,
    );
  }

  const size   = CORNER_SIZE * 2 + TILE_W * perSide;
  const right  = AREA.x + size;
  const bottom = AREA.y + size;

  // First index of each side, walking anticlockwise from GO in the bottom-right.
  const [c0, c1, c2, c3] = [0, 1, 2, 3].map((k) => k * (perSide + 1));

  const corner = (x: number, y: number, side: BoardSide, rotation: number): TileLayout =>
    ({ x, y, rotation, w: CORNER_SIZE, h: CORNER_SIZE, isCorner: true, side });

  const tiles: TileLayout[] = new Array(tileCount);

  for (let i = 0; i < tileCount; i++) {
    if (i === c0) {
      tiles[i] = corner(right - CORNER_SIZE / 2, bottom - CORNER_SIZE / 2, 'bottom', 0);
    } else if (i === c1) {
      tiles[i] = corner(AREA.x + CORNER_SIZE / 2, bottom - CORNER_SIZE / 2, 'bottom', 0);
    } else if (i === c2) {
      tiles[i] = corner(AREA.x + CORNER_SIZE / 2, AREA.y + CORNER_SIZE / 2, 'top', 180);
    } else if (i === c3) {
      tiles[i] = corner(right - CORNER_SIZE / 2, AREA.y + CORNER_SIZE / 2, 'top', 180);
    } else if (i < c1) {
      tiles[i] = mid(right - CORNER_SIZE - (i - c0 - 1) * TILE_W - TILE_W / 2,
                     bottom - CORNER_SIZE / 2, 0, 'bottom');
    } else if (i < c2) {
      tiles[i] = mid(AREA.x + CORNER_SIZE / 2,
                     bottom - CORNER_SIZE - (i - c1 - 1) * TILE_W - TILE_W / 2, 90, 'left');
    } else if (i < c3) {
      tiles[i] = mid(AREA.x + CORNER_SIZE + (i - c2 - 1) * TILE_W + TILE_W / 2,
                     AREA.y + CORNER_SIZE / 2, 180, 'top');
    } else {
      tiles[i] = mid(right - CORNER_SIZE / 2,
                     AREA.y + CORNER_SIZE + (i - c3 - 1) * TILE_W + TILE_W / 2, 270, 'right');
    }
  }

  return {
    tiles,
    backdrop: { kind: 'square', x: AREA.x, y: AREA.y, size },
    centre: { x: AREA.x + size / 2, y: AREA.y + size / 2 },
  };
}

function mid(x: number, y: number, rotation: number, side: BoardSide): TileLayout {
  return { x, y, rotation, w: TILE_W, h: TILE_H, isCorner: false, side };
}

// ─── Rings ────────────────────────────────────────────────────────────────────

function ringsGeometry(rings: RingSpec[], depth: number, tileCount: number): BoardGeometry {
  const declared = rings.reduce((n, ring) => n + ring.count, 0);
  if (declared !== tileCount) {
    throw new Error(
      `[BoardLayout] the rings hold ${declared} tiles but the map has ${tileCount}`,
    );
  }
  if (rings.some((ring) => ring.count < 3)) {
    throw new Error('[BoardLayout] a ring needs at least three tiles');
  }

  const centre = { x: AREA.x + AREA.size / 2, y: AREA.y + AREA.size / 2 };
  const tiles: TileLayout[] = [];

  for (const ring of rings) {
    // A tile is a rectangle, so its *inner* corners are the ones that collide:
    // they sit closer to the centre than the tile's midline, where the same
    // angular step buys less room. Sizing off the arc at the middle of the tile
    // looks right and overlaps every neighbour.
    const step = Math.PI / ring.count;                       // half the angle per tile
    const inner = Math.max(1, ring.radius - depth / 2);
    const w = Math.max(14, 2 * inner * Math.tan(step) - 2);

    for (let i = 0; i < ring.count; i++) {
      // Start at the bottom of the circle and work round clockwise, so tile 0
      // sits where GO does on the classic board.
      const angle = Math.PI / 2 + (i * 2 * Math.PI) / ring.count;
      tiles.push({
        x: centre.x + Math.cos(angle) * ring.radius,
        y: centre.y + Math.sin(angle) * ring.radius,
        // Local "up" has to point at the centre: that is the tile's angle less a
        // quarter turn.
        rotation: (angle * 180) / Math.PI - 90,
        w,
        h: depth,
        isCorner: false,
        side: null,
      });
    }
  }

  const outer = Math.max(...rings.map((r) => r.radius));
  return {
    tiles,
    backdrop: { kind: 'circle', x: centre.x, y: centre.y, size: outer + depth / 2 + 6 },
    centre,
  };
}
