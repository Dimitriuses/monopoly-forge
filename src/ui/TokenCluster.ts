// ─── TokenCluster ─────────────────────────────────────────────────────────────
// Where each token sits when several share a tile. One sits in the middle, two
// take the ends of a line, three make a triangle, and more spread around a ring —
// so a crowded square reads as N pieces rather than one piece with a fringe.
//
// Pure geometry, no Phaser: the scene asks where a token goes and does the
// moving. The tokens also shrink as the crowd grows, because six 22px pieces do
// not fit inside a 56px tile at full size however they are arranged.

export interface TokenSlot {
  dx: number;
  dy: number;
  /** Draw scale for the piece, shrinking as the tile gets busier. */
  scale: number;
}

/** Ring radius and token scale, indexed by how many share the tile. */
const RINGS: ReadonlyArray<{ radius: number; scale: number }> = [
  { radius: 0,  scale: 1 },     // 1 — dead centre
  { radius: 11, scale: 1 },     // 2 — the ends of a line
  { radius: 12, scale: 0.92 },  // 3 — a triangle
  { radius: 13, scale: 0.82 },  // 4
  { radius: 14, scale: 0.74 },  // 5
  { radius: 15, scale: 0.66 },  // 6 — the most players the game allows
];

export function tokenSlot(index: number, count: number): TokenSlot {
  if (count <= 1) return { dx: 0, dy: 0, scale: 1 };

  const ring = RINGS[Math.min(count, RINGS.length) - 1];
  // A pair reads best side by side; everything else starts at the top so the
  // arrangement is symmetrical about the tile's vertical axis.
  const start = count === 2 ? Math.PI : -Math.PI / 2;
  const angle = start + (index * 2 * Math.PI) / count;

  return {
    dx: round(Math.cos(angle) * ring.radius),
    dy: round(Math.sin(angle) * ring.radius),
    scale: ring.scale,
  };
}

/** One decimal place, and never `-0` — sin(2π) is a hair below zero. */
function round(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}
