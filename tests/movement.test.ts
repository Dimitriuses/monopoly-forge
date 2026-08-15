import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { knownMovements, registerMovement } from '@/game/Movement';
import { validateMap, type GameMap } from '@/maps';
import { gameById } from '@/games';
import { unloadGame } from '@/games/scope';
import type { TileDefinition } from '@/tiles/Tile';

// ─── Movement ─────────────────────────────────────────────────────────────────
// The engine half of Ultimate Monopoly: a board that is more than one loop.
// These use a tiny made-up board rather than the real one, so a failure points
// at the walking rather than at 120 tiles of data.

/** Two loops of six, joined at one junction: tile 2 ↔ tile 8. */
function twoLoops(): GameMap {
  const tiles: TileDefinition[] = Array.from({ length: 12 }, (_, id) => ({
    id, type: id === 0 ? 'go' : id === 6 ? 'jail' : 'freeParking', name: `T${id}`,
  }));
  return {
    id: 'twoloops', name: 'Two Loops', blurb: 'two loops of six',
    tiles,
    tracks: [
      { id: 'a', from: 0, count: 6 },
      { id: 'b', from: 6, count: 6 },
    ],
    junctions: [{ a: 2, b: 8 }],
    layout: { kind: 'rings', depth: 44, rings: [
      { count: 6, radius: 300 }, { count: 6, radius: 240 },
    ] },
  };
}

const tracked = (map: GameMap) => new Board(map, { movement: 'tracks' });

describe('movement — the circuit is the default', () => {
  it('ships circuit and tracks', () => {
    expect(knownMovements()).toEqual(expect.arrayContaining(['circuit', 'tracks']));
  });

  it('a board with no declared tracks is one loop', () => {
    const board = new Board();
    expect(board.tracks).toHaveLength(1);
    expect(board.tracks[0].count).toBe(40);
    expect(board.move(38, 4).to).toBe(2);
  });
});

describe('movement — tracks', () => {
  it('stays on its own loop, wrapping within it', () => {
    const board = tracked(twoLoops());
    // Track a is 0–5, so five steps from 3 wraps to 2 without ever leaving it.
    expect(board.move(3, 5).path).toEqual([4, 5, 0, 1, 2]);
    // Track b is 6–11 and wraps to 6, not to 0.
    expect(board.move(10, 3).path).toEqual([11, 6, 7]);
  });

  it('crosses at a junction only when the move is allowed to', () => {
    const board = tracked(twoLoops());
    // Odd roll: tile 2 is a junction but nothing happens, so 2 → 3.
    expect(board.move(1, 2, { crossing: false }).path).toEqual([2, 3]);
    // Even roll: stepping *off* 2 leaves from its partner 8 instead, so 2 → 9.
    expect(board.move(1, 2, { crossing: true }).path).toEqual([2, 9]);
  });

  it('crosses in both directions', () => {
    const board = tracked(twoLoops());
    expect(board.move(7, 2, { crossing: true }).path).toEqual([8, 3]);
  });

  it('finds a route to the other loop, and reports there is none', () => {
    const board = tracked(twoLoops());
    // Reachable only by riding the junction.
    expect(board.pathTo(0, 9)).toEqual([1, 2, 9]);
    // And the shortest route on your own loop is still the plain one.
    expect(board.pathTo(0, 4)).toEqual([1, 2, 3, 4]);
  });

  it('scans the whole board, not just the loop it starts on', () => {
    const board = tracked(twoLoops());
    expect(board.scan(0, (tile) => tile.type === 'jail')).toBe(6);
  });

  it('knows which loop a tile is on', () => {
    const board = tracked(twoLoops());
    expect(board.trackOf(4).id).toBe('a');
    expect(board.trackOf(9).id).toBe('b');
    expect(board.junctionPartner(2)).toBe(8);
    expect(board.junctionPartner(8)).toBe(2);
    expect(board.junctionPartner(5)).toBeNull();
  });
});

describe('movement — a map that declares tracks has to mean it', () => {
  it('refuses tracks that do not cover the board end to end', () => {
    const map = twoLoops();
    map.tracks = [{ id: 'a', from: 0, count: 6 }];
    expect(validateMap(map).map((p) => p.problem).join(' '))
      .toContain('cover 6 tiles but it has 12');
  });

  it('refuses a track that does not start where the last one ended', () => {
    const map = twoLoops();
    map.tracks = [{ id: 'a', from: 0, count: 6 }, { id: 'b', from: 7, count: 5 }];
    expect(validateMap(map).map((p) => p.problem).join(' '))
      .toContain('tracks must run end to end');
  });

  it('refuses a junction that joins a loop to itself', () => {
    const map = twoLoops();
    map.junctions = [{ a: 1, b: 4 }];
    expect(validateMap(map).map((p) => p.problem).join(' '))
      .toContain('joins track "a" to itself');
  });

  it('refuses junctions with no tracks at all', () => {
    const map = twoLoops();
    map.tracks = undefined;
    expect(validateMap(map).map((p) => p.problem).join(' '))
      .toContain('junctions but no tracks');
  });
});

describe('movement — a strategy a game brings', () => {
  beforeEach(() => { unloadGame(); });

  it('is refused by name when this build has not registered it', () => {
    // `gameById` loads before it validates, so an unknown strategy is caught
    // rather than throwing out of the Board constructor.
    expect(() => new Board(twoLoops(), { movement: 'teleport' })).toThrow(/teleport/);
  });

  it('takes one registered over the built-ins', () => {
    registerMovement('backwards', {
      next: (board, from) => ((from - 1) % board.size + board.size) % board.size,
    });
    const board = new Board(twoLoops(), { movement: 'backwards' });
    expect(board.move(3, 2).path).toEqual([2, 1]);
    unloadGame();
  });
});

describe('movement — the game that needed it', () => {
  beforeEach(() => { unloadGame(); });

  it('Ultimate Monopoly loads, validates and is three loops', () => {
    const game  = gameById('ultimate');
    const board = new Board(game.map, { movement: 'tracks' });
    expect(board.size).toBe(120);
    expect(board.tracks.map((t) => `${t.id}:${t.count}`))
      .toEqual(['middle:40', 'outer:56', 'inner:24']);
  });

  /**
   * Straight out of the printed rules: "if a player starts their turn on States
   * Avenue and rolls a four, the move would take the player's piece over: (1)
   * VIRGINIA AVENUE, (2) PENNSYLVANIA RAILROAD/TRANSIT STATION, (3) FIFTH AVENUE
   * and finally landing on (4) MADISON AVENUE."
   *
   * The first two are on the middle track and the last two on the inner one, so
   * this single assertion is the whole feature.
   */
  it('walks the rules’ own worked example across two tracks', () => {
    const game  = gameById('ultimate');
    const board = new Board(game.map, { movement: 'tracks' });

    const states = board.tiles.findIndex((t) => t.name === 'States Ave');
    const { to, path } = board.move(states, 4, { crossing: true });

    expect(path.map((id) => board.getTile(id).name)).toEqual([
      'Virginia Ave', 'Pennsylvania Railroad', 'Fifth Avenue', 'Madison Avenue',
    ]);
    expect(board.getTile(to).name).toBe('Madison Avenue');
    expect(board.trackOf(to).id).toBe('inner');
  });

  it('an odd roll from the same square never leaves the middle track', () => {
    const game  = gameById('ultimate');
    const board = new Board(game.map, { movement: 'tracks' });

    const states = board.tiles.findIndex((t) => t.name === 'States Ave');
    const { to } = board.move(states, 5, { crossing: false });
    expect(board.trackOf(to).id).toBe('middle');
  });

  it('joins outer to middle and middle to inner, never outer to inner', () => {
    const game  = gameById('ultimate');
    const board = new Board(game.map, { movement: 'tracks' });

    for (const { a, b } of game.map.junctions!) {
      const pair = [board.trackOf(a).id, board.trackOf(b).id].sort().join('-');
      expect(['inner-middle', 'middle-outer']).toContain(pair);
    }
  });
});

describe('layout — concentric squares', () => {
  const geometry = () => {
    const board = new Board(gameById('ultimate').map, { movement: 'tracks' });
    return board;
  };

  /**
   * No two *pieces* may stand in the same place. It is asked of tokenPoint
   * rather than of the drawn rectangle because a junction is deliberately drawn
   * as one space across two rings — the two tiles share a footprint and keep
   * their own halves to stand in, which is the whole of that feature.
   */
  it('lays 120 tiles out as three nested squares, none standing on another', () => {
    const board = geometry();
    const seen = new Set<string>();
    for (let id = 0; id < board.size; id++) {
      const { x, y } = board.tokenPoint(id);
      const key = `${Math.round(x)},${Math.round(y)}`;
      expect(seen.has(key), `two tiles share ${key}`).toBe(false);
      seen.add(key);
    }
  });

  /**
   * One space, two halves — and each half keeps the width its own ring gives it.
   * Forcing the pair into a single rectangle is what overlapped the neighbours:
   * concentric rings divide different perimeters by different counts, so their
   * tiles are 43, 49 and 64 across and any one width overhangs somebody.
   */
  it('draws a junction as one space, each half sized by its own ring', () => {
    const board = geometry();
    for (const { a, b } of gameById('ultimate').map.junctions!) {
      const first = board.getLayout(a);
      const second = board.getLayout(b);

      // Abutting, one directly inside the other.
      expect(Math.hypot(first.x - second.x, first.y - second.y))
        .toBeCloseTo((first.h + second.h) / 2, 1);
      // Opposite edges shared, so the two outlines join into one.
      expect([first.sharedEdge, second.sharedEdge].sort()).toEqual(['bottom', 'top']);
      // And each keeps its own ring's width.
      expect(first.w).toBe(board.getLayout(a + 1).w);
      expect(second.w).toBe(board.getLayout(b + 1).w);
    }
  });

  /** The glitch itself: no tile may be drawn over another. */
  it('draws no tile on top of another', () => {
    const board = geometry();
    const box = (i: number) => {
      const l = board.getLayout(i);
      const vertical = Math.abs(Math.round(l.rotation)) % 180 === 90;
      const w = vertical ? l.h : l.w;
      const h = vertical ? l.w : l.h;
      return { x1: l.x - w / 2, x2: l.x + w / 2, y1: l.y - h / 2, y2: l.y + h / 2 };
    };
    for (let i = 0; i < board.size; i++) {
      for (let j = i + 1; j < board.size; j++) {
        const A = box(i); const B = box(j);
        const overlap = Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1) > 0.5
                     && Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1) > 0.5;
        expect(overlap, `${board.getTile(i).name} overlaps ${board.getTile(j).name}`)
          .toBe(false);
      }
    }
  });

  it('draws each track inside the one outside it', () => {
    const board = geometry();
    // A track's distance from the centre, taken at its widest.
    const spread = (track: string) => {
      let far = 0;
      for (let id = 0; id < board.size; id++) {
        if (board.trackOf(id).id !== track) continue;
        const { x, y } = board.getLayout(id);
        far = Math.max(far, Math.abs(x - board.centre.x), Math.abs(y - board.centre.y));
      }
      return far;
    };
    expect(spread('outer')).toBeGreaterThan(spread('middle'));
    expect(spread('middle')).toBeGreaterThan(spread('inner'));
  });

  it('keeps every tile inside the board it is drawn on', () => {
    const board = geometry();
    const { x, y, size } = board.backdrop;
    for (let id = 0; id < board.size; id++) {
      const layout = board.getLayout(id);
      expect(layout.x).toBeGreaterThanOrEqual(x);
      expect(layout.x).toBeLessThanOrEqual(x + size);
      expect(layout.y).toBeGreaterThanOrEqual(y);
      expect(layout.y).toBeLessThanOrEqual(y + size);
      expect(layout.w).toBeGreaterThan(0);
      expect(layout.h).toBeGreaterThan(0);
    }
  });

  it('refuses a ring that is not 4n + 4, and rings drawn on top of each other', () => {
    const bad = { ...twoLoops(), layout: {
      kind: 'squares' as const, depth: 60,
      rings: [{ count: 7, inset: 0 }, { count: 5, inset: 10 }],
    } };
    const said = validateMap(bad).map((p) => p.problem).join(' ');
    expect(said).toContain('4n + 4');
    expect(said).toContain('closer than a tile is deep');
  });
});
