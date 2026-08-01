import { describe, it, expect } from 'vitest';
import { Board } from '@/game/Board';
import { BOARD_TILES } from '@/config';

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

  it('keeps tile ids aligned with their board index', () => {
    board.tiles.forEach((tile, i) => expect(tile.id).toBe(i));
    BOARD_TILES.forEach((def, i) => expect(def.id).toBe(i));
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
    expect(board.move(0, 5)).toEqual({ to: 5, passedGo: false });
    expect(board.move(12, 7)).toEqual({ to: 19, passedGo: false });
  });

  it('wraps past 39 and reports passing GO', () => {
    expect(board.move(38, 5)).toEqual({ to: 3, passedGo: true });
  });

  it('treats landing exactly on GO as passing GO', () => {
    expect(board.move(35, 5)).toEqual({ to: 0, passedGo: true });
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
});
