import { describe, it, expect } from 'vitest';
import { computeGeometry, type LayoutSpec, type TileLayout } from '@/game/BoardLayout';

/**
 * How much a tile's local "up" — the edge the colour stripe sits on — agrees
 * with the direction to the middle of the board. 1 is dead on, 0 is sideways,
 * negative means the tile has its back to the board.
 *
 * This is the invariant that lets one draw path serve a square, a circle or
 * anything else: whatever the shape, the interior is past the tile's top edge.
 * On a ring every tile points *exactly* at the centre; on a square a tile points
 * into the board but not at its middle, because a row faces its row.
 */
function inwardness(tile: TileLayout, centre: { x: number; y: number }): number {
  const angle = (tile.rotation * Math.PI) / 180;
  const up = { x: Math.sin(angle), y: -Math.cos(angle) };   // (0,-1) turned by `angle`
  const toCentre = { x: centre.x - tile.x, y: centre.y - tile.y };
  const length = Math.hypot(toCentre.x, toCentre.y);
  if (length < 0.001) return 1;                             // a tile *at* the centre
  return (up.x * toCentre.x + up.y * toCentre.y) / length;
}

const geometryOf = (spec: LayoutSpec, count: number) => computeGeometry(spec, count);

describe('BoardLayout — the square', () => {
  const geometry = geometryOf({ kind: 'square' }, 40);

  it('lays 40 tiles out with four corners', () => {
    expect(geometry.tiles).toHaveLength(40);
    expect(geometry.tiles.filter((t) => t.isCorner)).toHaveLength(4);
    expect([0, 10, 20, 30].every((i) => geometry.tiles[i].isCorner)).toBe(true);
  });

  it('turns each side to face the middle', () => {
    expect(geometry.tiles[1].rotation).toBe(0);      // bottom row
    expect(geometry.tiles[15].rotation).toBe(90);    // left column
    expect(geometry.tiles[25].rotation).toBe(180);   // top row
    expect(geometry.tiles[35].rotation).toBe(270);   // right column
    // Every tile has the board on the side its stripe is drawn, even though a
    // corner faces its row rather than the diagonal.
    for (const tile of geometry.tiles) {
      expect(inwardness(tile, geometry.centre)).toBeGreaterThan(0);
    }
  });

  it('gives every tile its own spot, and a square backdrop', () => {
    const seen = new Set(geometry.tiles.map((t) => `${t.x},${t.y}`));
    expect(seen.size).toBe(40);
    expect(geometry.backdrop.kind).toBe('square');
  });

  it('scales to a shorter circuit', () => {
    const small = geometryOf({ kind: 'square' }, 12);
    expect(small.tiles).toHaveLength(12);
    expect(small.tiles.filter((t) => t.isCorner)).toHaveLength(4);
    expect(small.backdrop.size).toBeLessThan(geometry.backdrop.size);
  });

  it('refuses a tile count that cannot make a square', () => {
    expect(() => geometryOf({ kind: 'square' }, 13)).toThrow(/four corners and equal sides/);
  });
});

describe('BoardLayout — a single ring', () => {
  const geometry = geometryOf({ kind: 'ring' }, 24);

  it('spaces every tile evenly around one circle', () => {
    const radii = geometry.tiles.map(
      (t) => Math.hypot(t.x - geometry.centre.x, t.y - geometry.centre.y),
    );
    radii.forEach((r) => expect(r).toBeCloseTo(radii[0], 3));
    expect(new Set(geometry.tiles.map((t) => `${t.x.toFixed(2)},${t.y.toFixed(2)}`)).size).toBe(24);
  });

  it('turns every tile to face the middle exactly', () => {
    for (const tile of geometry.tiles) {
      expect(inwardness(tile, geometry.centre)).toBeCloseTo(1, 3);
    }
  });

  it('starts the circuit at the bottom, where GO belongs', () => {
    expect(geometry.tiles[0].x).toBeCloseTo(geometry.centre.x, 3);
    expect(geometry.tiles[0].y).toBeGreaterThan(geometry.centre.y);
  });

  it('has no corners and a round backdrop', () => {
    expect(geometry.tiles.some((t) => t.isCorner)).toBe(false);
    expect(geometry.tiles.every((t) => t.side === null)).toBe(true);
    expect(geometry.backdrop.kind).toBe('circle');
  });

  // A rectangle's inner corners are the ones that collide, so the width has to be
  // sized off the arc at the tile's inner edge rather than at its middle.
  it('sizes tiles so that neighbours do not overlap', () => {
    for (const tile of geometry.tiles) {
      const radius = Math.hypot(tile.x - geometry.centre.x, tile.y - geometry.centre.y);
      const inner = radius - tile.h / 2;
      const room = 2 * inner * Math.tan(Math.PI / geometry.tiles.length);
      expect(tile.w).toBeLessThanOrEqual(room);
    }
  });
});

describe('BoardLayout — concentric rings', () => {
  const spec: LayoutSpec = {
    kind: 'rings',
    depth: 62,
    rings: [{ count: 12, radius: 272 }, { count: 9, radius: 188 }, { count: 9, radius: 104 }],
  };
  const geometry = geometryOf(spec, 30);

  it('deals the circuit into the rings in order', () => {
    const radiusOf = (t: TileLayout) =>
      Math.hypot(t.x - geometry.centre.x, t.y - geometry.centre.y);

    expect(geometry.tiles).toHaveLength(30);
    geometry.tiles.slice(0, 12).forEach((t) => expect(radiusOf(t)).toBeCloseTo(272, 3));
    geometry.tiles.slice(12, 21).forEach((t) => expect(radiusOf(t)).toBeCloseTo(188, 3));
    geometry.tiles.slice(21).forEach((t) => expect(radiusOf(t)).toBeCloseTo(104, 3));
  });

  it('turns every tile on every ring to face the middle exactly', () => {
    for (const tile of geometry.tiles) {
      expect(inwardness(tile, geometry.centre)).toBeCloseTo(1, 3);
    }
  });

  it('draws a backdrop that covers the outermost ring', () => {
    expect(geometry.backdrop.kind).toBe('circle');
    expect(geometry.backdrop.size).toBeGreaterThan(272 + 62 / 2);
  });

  it('refuses rings that do not add up to the circuit', () => {
    expect(() => geometryOf(spec, 29)).toThrow(/rings hold 30 tiles but the map has 29/);
  });

  it('refuses a ring too small to be a ring', () => {
    expect(() => geometryOf(
      { kind: 'rings', rings: [{ count: 2, radius: 100 }] }, 2,
    )).toThrow(/at least three tiles/);
  });
});
