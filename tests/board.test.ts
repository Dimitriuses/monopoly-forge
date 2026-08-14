import { describe, it, expect } from 'vitest';
import { Board } from '@/game/Board';
import { CLASSIC_MAP } from '@/maps';
import type { TileDefinition } from '@/tiles/Tile';

describe('Board — tile registry', () => {
  const board = new Board();

  it('constructs all 40 tiles', () => {
    expect(board.tiles).toHaveLength(40);
    expect(board.tiles.every((t) => t !== undefined)).toBe(true);
  });

  it('places the four corners at the canonical indices', () => {
    expect(board.getTile(0).type).toBe('go');
    expect(board.getTile(10).type).toBe('jail');
    expect(board.getTile(20).type).toBe('freeParking');
    expect(board.getTile(30).type).toBe('goToJail');
  });

  it('matches the tile-type census of a standard board', () => {
    const census = board.tiles.reduce<Record<string, number>>((acc, t) => {
      acc[t.type] = (acc[t.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(census).toEqual({
      go: 1, property: 22, railroad: 4, utility: 2, tax: 2,
      chance: 3, communityChest: 3, jail: 1, freeParking: 1, goToJail: 1,
    });
  });

  it('takes its size from the map rather than a constant', () => {
    expect(board.size).toBe(CLASSIC_MAP.tiles.length);
  });

  it('resolves the anchors by role instead of by index', () => {
    expect(board.anchor('start')).toBe(0);
    expect(board.anchor('jail')).toBe(10);
    expect(board.anchor('goToJail')).toBe(30);
  });

  it('keeps tile ids aligned with their board index', () => {
    board.tiles.forEach((tile, i) => expect(tile.id).toBe(i));
    CLASSIC_MAP.tiles.forEach((def, i) => expect(def.id).toBe(i));
  });

  // Board.getTile / getLayout throw descriptive errors instead of returning
  // undefined — the guard added after `tile is undefined` crashes in play.
  it('rejects non-finite indices rather than returning undefined', () => {
    expect(() => board.getTile(NaN)).toThrow(/non-finite/);
    expect(() => board.getTile(Infinity)).toThrow(/non-finite/);
    expect(() => board.getLayout(NaN)).toThrow(/non-finite/);
  });
});

describe('Board.move — positive modulo', () => {
  const board = new Board();

  it('moves forward without wrapping', () => {
    expect(board.move(0, 5)).toEqual({ to: 5, path: [1, 2, 3, 4, 5], passedGo: false });
    expect(board.move(12, 7).to).toBe(19);
  });

  it('wraps past 39 and reports passing GO', () => {
    expect(board.move(38, 5)).toEqual({ to: 3, path: [39, 0, 1, 2, 3], passedGo: true });
  });

  it('treats landing exactly on GO as passing GO', () => {
    expect(board.move(35, 5)).toEqual({ to: 0, path: [36, 37, 38, 39, 0], passedGo: true });
  });

  // The path is every tile stepped *onto*, never the one stepped off, so its
  // length is always the number of steps — that is what the tokens walk.
  it('reports a path of exactly `steps` tiles, ending where it says', () => {
    for (const steps of [1, 2, 7, 12, 40, 41]) {
      const { to, path } = board.move(17, steps);
      expect(path).toHaveLength(steps);
      expect(path.at(-1)).toBe(to);
    }
    // Excluding the tile stepped off only means the *first* step is not it — a
    // walk of a full lap or more comes back round through it, as it should.
    expect(board.move(17, 12).path).not.toContain(17 as never);
    expect(board.move(17, 40).path).toContain(17 as never);
  });

  // Going back past GO has never paid the salary and must not start now.
  it('never reports passing GO on a backwards walk', () => {
    const { to, path, passedGo } = board.move(2, -5);
    expect(to).toBe(37);
    expect(path).toEqual([1, 0, 39, 38, 37]);
    expect(passedGo).toBe(false);
  });

  // Regression: JS `%` preserves sign, so `(-1 + steps) % 40` could return a
  // negative index and `tiles[-1]` is undefined. move() uses ((f+s)%40+40)%40.
  it('never returns a negative index, whatever the inputs', () => {
    expect(board.move(-1, 3).to).toBe(2);
    expect(board.move(5, -10).to).toBe(35);
    expect(board.move(0, -1).to).toBe(39);

    for (let from = -50; from <= 50; from++) {
      for (let steps = -50; steps <= 50; steps++) {
        const { to } = board.move(from, steps);
        expect(Number.isInteger(to)).toBe(true);
        expect(to).toBeGreaterThanOrEqual(0);
        expect(to).toBeLessThanOrEqual(39);
      }
    }
  });

  it('throws on non-finite arguments instead of cascading NaN', () => {
    expect(() => board.move(NaN, 5)).toThrow(/non-finite/);
    expect(() => board.move(5, NaN)).toThrow(/non-finite/);
  });
});

describe('Board — layout geometry', () => {
  const board = new Board();
  const layouts = Array.from({ length: 40 }, (_, i) => board.getLayout(i));

  it('gives every tile a distinct screen position', () => {
    const seen = new Set(layouts.map((l) => `${l.x},${l.y}`));
    expect(seen.size).toBe(40);
  });

  it('assigns each tile to the correct side of the board', () => {
    expect(layouts[0].side).toBe('bottom');
    expect(layouts[10].side).toBe('bottom');
    expect(layouts[15].side).toBe('left');
    expect(layouts[20].side).toBe('top');
    expect(layouts[30].side).toBe('top');
    expect(layouts[35].side).toBe('right');
  });

  // The M1 rendering bugs: tiles 10 and 30 were positioned with the mid-row
  // formula and overshot their corners.
  it('aligns the four corners into a square', () => {
    expect(layouts[0].y).toBeCloseTo(layouts[10].y);   // bottom edge
    expect(layouts[20].y).toBeCloseTo(layouts[30].y);  // top edge
    expect(layouts[10].x).toBeCloseTo(layouts[20].x);  // left edge
    expect(layouts[0].x).toBeCloseTo(layouts[30].x);   // right edge
  });

  it('runs the bottom row right-to-left and the top row left-to-right', () => {
    for (let i = 1; i < 10; i++) expect(layouts[i].x).toBeLessThan(layouts[i - 1].x);
    for (let i = 21; i < 30; i++) expect(layouts[i].x).toBeGreaterThan(layouts[i - 1].x);
  });

  it('runs the left column bottom-to-top and the right column top-to-bottom', () => {
    for (let i = 12; i < 20; i++) expect(layouts[i].y).toBeLessThan(layouts[i - 1].y);
    for (let i = 32; i < 40; i++) expect(layouts[i].y).toBeGreaterThan(layouts[i - 1].y);
  });

  // Every tile is a rectangle in its own frame with the board's middle past its
  // top edge, so a column tile is a *row* tile turned a quarter turn — same
  // footprint, different rotation. That is what lets one draw path serve a
  // square, a circle or anything else.
  it('gives every tile the same footprint and lets rotation orient it', () => {
    expect(layouts[0].isCorner).toBe(true);
    expect(layouts[0].w).toBe(layouts[0].h);

    expect(layouts[1].w).toBeLessThan(layouts[1].h);   // narrow across, deep inward
    expect(layouts[15].w).toBe(layouts[1].w);
    expect(layouts[15].h).toBe(layouts[1].h);

    expect(layouts[1].rotation).toBe(0);      // bottom row: interior is up
    expect(layouts[15].rotation).toBe(90);    // left column: interior is right
    expect(layouts[25].rotation).toBe(180);   // top row: interior is down
    expect(layouts[35].rotation).toBe(270);   // right column: interior is left
  });
});

// ROADMAP 8a: the classic board is one map, not the only one. These pin the
// generalisation — a shorter circuit has to lay out and wrap on its own terms.
describe('Board — a map that is not the classic 40 tiles', () => {
  const property = (id: number, group: 'brown' | 'red'): TileDefinition => ({
    id, type: 'property', name: `Lot ${id}`, group,
    price: 100, houseCost: 50, mortgage: 50, rent: [1, 2, 3, 4, 5, 6],
  });

  // 12 tiles: four corners with two lots on each side.
  const TINY: TileDefinition[] = [
    { id: 0, type: 'go', name: 'GO' },
    property(1, 'brown'), property(2, 'brown'),
    { id: 3, type: 'jail', name: 'Jail' },
    property(4, 'red'), property(5, 'red'),
    { id: 6, type: 'freeParking', name: 'Free Parking' },
    { id: 7, type: 'chance', name: 'Chance' },
    { id: 8, type: 'tax', name: 'Tax', amount: 50 },
    { id: 9, type: 'goToJail', name: 'Go to Jail' },
    { id: 10, type: 'railroad', name: 'Depot', price: 200, mortgage: 100 },
    { id: 11, type: 'utility', name: 'Waterworks', price: 150, mortgage: 75 },
  ];

  const tiny = new Board(TINY);

  it('reports the map’s own size', () => {
    expect(tiny.size).toBe(12);
    expect(tiny.tiles).toHaveLength(12);
  });

  it('wraps at the map’s length, not at 40', () => {
    expect(tiny.move(10, 5)).toEqual({ to: 3, path: [11, 0, 1, 2, 3], passedGo: true });
    expect(tiny.move(0, -1).to).toBe(11);
    expect(tiny.stepsBetween(10, 2)).toBe(4);
  });

  it('finds the anchors wherever the map put them', () => {
    expect(tiny.anchor('start')).toBe(0);
    expect(tiny.anchor('jail')).toBe(3);
    expect(tiny.anchor('goToJail')).toBe(9);
  });

  it('lays the corners out as a square with two tiles a side', () => {
    const layouts = Array.from({ length: 12 }, (_, i) => tiny.getLayout(i));
    expect(new Set(layouts.map((l) => `${l.x},${l.y}`)).size).toBe(12);
    expect(layouts.filter((l) => l.isCorner)).toHaveLength(4);
    expect([0, 3, 6, 9].every((i) => layouts[i].isCorner)).toBe(true);
    expect(layouts[0].y).toBeCloseTo(layouts[3].y);   // bottom edge
    expect(layouts[6].y).toBeCloseTo(layouts[9].y);   // top edge
    expect(layouts[4].side).toBe('left');
    expect(layouts[10].side).toBe('right');
  });

  it('reports a missing anchor rather than guessing an index', () => {
    const noJail = new Board(TINY.map((t) =>
      t.type === 'jail' ? { ...t, type: 'freeParking' as const, name: 'Rest Stop' } : t,
    ));
    expect(noJail.tryAnchor('jail')).toBeNull();
    expect(() => noJail.anchor('jail')).toThrow(/no tile plays/);
  });

  it('refuses a tile count that cannot make a square', () => {
    expect(() => new Board(TINY.slice(0, 11))).toThrow(/four corners and equal sides/);
  });
});
