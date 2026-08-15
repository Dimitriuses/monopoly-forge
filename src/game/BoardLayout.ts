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
  /**
   * Which of this tile's own edges it shares with the tile it is joined to, in
   * its local frame — `top` faces the board's interior, `bottom` the rim.
   *
   * Set on both halves of a junction, and the only thing that makes them read as
   * one space: the shared edge is **not stroked**, so two abutting rectangles
   * are drawn as a single outline around both. See `mergeJunctions`.
   */
  sharedEdge?: 'top' | 'bottom';
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
 * - `rings` — concentric circles, tiles dealt to each in order.
 * - `squares` — concentric squares, the classic shape more than once.
 *
 * **A shape is not a topology.** Dealing tiles to three rings does not make them
 * three loops; whether the circuit runs 0 → n-1 → 0 or splits into loops joined
 * at junctions is `GameMap.tracks` and `rules.movement` — see `game/Movement.ts`.
 * Orbits is three rings of one loop; Ultimate Monopoly is three squares of three.
 */
export type LayoutSpec =
  | { kind: 'square' }
  | { kind: 'ring'; depth?: number }
  | { kind: 'rings'; rings: RingSpec[]; depth?: number }
  | { kind: 'squares'; rings: SquareRingSpec[]; depth?: number };

export interface RingSpec {
  count: number;
  /** Distance from the board's centre to the middle of the tile. */
  radius: number;
}

export interface SquareRingSpec {
  count: number;
  /** How far in from the board's edge this ring's outer edge sits. */
  inset: number;
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
    case 'squares': return squaresGeometry(spec.rings, spec.depth ?? RING_DEPTH, tileCount);
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

// ─── Concentric squares ───────────────────────────────────────────────────────
// The classic shape, more than once. `rings` (circles) could already hold a board
// of several loops, and Ultimate Monopoly is drawn on it perfectly well — but the
// board it is a copy of is three nested squares, and a board should be allowed to
// look like the thing it is.
//
// Each ring is `squareGeometry` again with three things parameterised: how far in
// from the edge it starts, how deep its tiles are, and how many it has. A corner
// is `depth × depth`, which is what keeps the nesting even — every ring sits
// exactly one tile-depth inside the one outside it, so `inset` is a multiple of
// `depth` in practice and the geometry does not care if it is not.
//
// `inset` is explicit rather than derived by walking the array, for the same
// reason a circle's `radius` is: **the drawing order is not the tile order.**
// Ultimate Monopoly lists its middle track first because GO has to be tile 0, and
// its middle track is the one drawn in the middle.

function squaresGeometry(
  rings: SquareRingSpec[], depth: number, tileCount: number,
): BoardGeometry {
  const declared = rings.reduce((n, ring) => n + ring.count, 0);
  if (declared !== tileCount) {
    throw new Error(
      `[BoardLayout] the squares hold ${declared} tiles but the map has ${tileCount}`,
    );
  }

  const tiles: TileLayout[] = [];

  for (const ring of rings) {
    const perSide = (ring.count - 4) / 4;
    if (!Number.isInteger(perSide) || perSide < 1) {
      throw new Error(
        `[BoardLayout] a square ring needs 4n + 4 tiles with n ≥ 1, not ${ring.count}`,
      );
    }

    const size = AREA.size - ring.inset * 2;
    const w    = (size - depth * 2) / perSide;
    if (w <= 0) {
      throw new Error(
        `[BoardLayout] a square ring inset ${ring.inset} has no room for ${perSide} tiles a side`,
      );
    }

    const x0     = AREA.x + ring.inset;
    const y0     = AREA.y + ring.inset;
    const right  = x0 + size;
    const bottom = y0 + size;

    // First index of each side, walking from the bottom-right the same way round
    // as `squareGeometry` — so tile 0 of every ring is where GO sits on the
    // classic board, and every ring turns the same way.
    const [c0, c1, c2, c3] = [0, 1, 2, 3].map((k) => k * (perSide + 1));

    const corner = (x: number, y: number, side: BoardSide, rotation: number): TileLayout =>
      ({ x, y, rotation, w: depth, h: depth, isCorner: true, side });
    const edge = (x: number, y: number, rotation: number, side: BoardSide): TileLayout =>
      ({ x, y, rotation, w, h: depth, isCorner: false, side });

    for (let i = 0; i < ring.count; i++) {
      if (i === c0) {
        tiles.push(corner(right - depth / 2, bottom - depth / 2, 'bottom', 0));
      } else if (i === c1) {
        tiles.push(corner(x0 + depth / 2, bottom - depth / 2, 'bottom', 0));
      } else if (i === c2) {
        tiles.push(corner(x0 + depth / 2, y0 + depth / 2, 'top', 180));
      } else if (i === c3) {
        tiles.push(corner(right - depth / 2, y0 + depth / 2, 'top', 180));
      } else if (i < c1) {
        tiles.push(edge(right - depth - (i - c0 - 1) * w - w / 2, bottom - depth / 2, 0, 'bottom'));
      } else if (i < c2) {
        tiles.push(edge(x0 + depth / 2, bottom - depth - (i - c1 - 1) * w - w / 2, 90, 'left'));
      } else if (i < c3) {
        tiles.push(edge(x0 + depth + (i - c2 - 1) * w + w / 2, y0 + depth / 2, 180, 'top'));
      } else {
        tiles.push(edge(right - depth / 2, y0 + depth + (i - c3 - 1) * w + w / 2, 270, 'right'));
      }
    }
  }

  return {
    tiles,
    backdrop: { kind: 'square', x: AREA.x, y: AREA.y, size: AREA.size },
    centre: { x: AREA.x + AREA.size / 2, y: AREA.y + AREA.size / 2 },
  };
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

/**
 * Draw a junction's two tiles as one space.
 *
 * On the printed Ultimate Monopoly board a RAILROAD and the TRANSIT STATION
 * beside it **are one square** — the rules say so outright ("TRANSIT STATIONS
 * and RAILROAD spaces are considered one space"), and the board draws them as a
 * single block straddling two rings with the tracks running through it. The
 * engine has always had them as two tiles because that is what movement needs:
 * stepping off one continues on your ring, stepping off the other crosses to
 * the next, and which happens is the parity of your roll.
 *
 * The reconciliation is **not** to give the pair one rectangle, and that is the
 * whole lesson here. Concentric rings do not share a tile width — Ultimate's
 * are 43, 49 and 64 pixels across, because each ring divides a different
 * perimeter by a different count — so a single rectangle has to pick one, and
 * whichever it picks overhangs its neighbours on the other ring by half the
 * difference. That was a visible overlap on all four junctions.
 *
 * Nor can the widths be tuned into agreement: equal pitch across 13, 9 and 5
 * tiles a side would need the rings so far apart that the two halves of a
 * junction would no longer touch, which is the one thing the whole idea rests
 * on.
 *
 * So each tile keeps its own rectangle, exactly as the ring around it demands,
 * and the pair is made one space by **not stroking the edge between them**. The
 * result is a single outline around a slightly stepped block — which is what the
 * shape honestly is, since the rings really do have different pitches.
 *
 * Only pairs that actually abut are joined: two tiles at opposite corners of the
 * board are a junction in the topology and nowhere near each other on screen.
 */
export function mergeJunctions(
  geometry: BoardGeometry, junctions: Array<{ a: number; b: number }>,
): void {
  for (const { a, b } of junctions) {
    const first  = geometry.tiles[a];
    const second = geometry.tiles[b];
    if (!first || !second) continue;
    // Different orientations cannot share a straight edge.
    if (Math.round(first.rotation) !== Math.round(second.rotation)) continue;

    // Touching means their centres sit half a depth apart on each side. Allow a
    // pixel of slack for the inset arithmetic and refuse anything further.
    const gap = Math.hypot(first.x - second.x, first.y - second.y);
    if (gap > (first.h + second.h) / 2 + 1) continue;

    // Which way the partner lies. `top` faces the board's interior, so the tile
    // further out shares its top edge and the one further in shares its bottom.
    const { x: cx, y: cy } = geometry.centre;
    const outer = Math.hypot(first.x - cx, first.y - cy)
                > Math.hypot(second.x - cx, second.y - cy) ? first : second;
    const inner = outer === first ? second : first;

    outer.sharedEdge = 'top';
    inner.sharedEdge = 'bottom';
  }
}
