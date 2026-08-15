import { describe, it, expect } from 'vitest';
import { MAPS, CLASSIC_MAP, ROUND_MAP, ORBIT_MAP, mapById, validateMap } from '@/maps';
import type { GameMap } from '@/maps';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { CardEffects } from '@/cards/CardDeck';
import type { TileDefinition } from '@/tiles/Tile';

const clone = (map: GameMap): GameMap => ({
  ...map,
  tiles: map.tiles.map((t) => ({ ...t })),
  layout: { ...map.layout },
});

const problemText = (map: GameMap) =>
  validateMap(map).map((p) => `${p.where}: ${p.problem}`).join('\n');

describe('The shipped maps', () => {
  it('all pass their own validator', () => {
    for (const map of Object.values(MAPS)) {
      expect(problemText(map), `${map.id} should be loadable`).toBe('');
    }
  });

  it('are each a different shape, which is the point of shipping them', () => {
    expect(CLASSIC_MAP.layout.kind).toBe('square');
    expect(ROUND_MAP.layout.kind).toBe('ring');
    expect(ORBIT_MAP.layout.kind).toBe('rings');
  });

  it('all build into a working board', () => {
    for (const map of Object.values(MAPS)) {
      const board = new Board(map);
      expect(board.size).toBe(map.tiles.length);
      expect(board.anchor('start')).toBeGreaterThanOrEqual(0);
      expect(board.anchor('jail')).toBeGreaterThanOrEqual(0);
      // Every tile has somewhere to be drawn.
      for (let i = 0; i < board.size; i++) {
        const layout = board.getLayout(i);
        expect(Number.isFinite(layout.x) && Number.isFinite(layout.y)).toBe(true);
        expect(layout.w).toBeGreaterThan(0);
      }
    }
  });

  it('wrap at their own length, not at 40', () => {
    expect(new Board(ROUND_MAP).move(23, 1).to).toBe(0);
    expect(new Board(ORBIT_MAP).move(29, 1).to).toBe(0);
    expect(new Board(CLASSIC_MAP).move(39, 1).to).toBe(0);
  });

  it('falls back to the classic board for an id it does not have', () => {
    expect(mapById('nonsense').id).toBe('classic');
    expect(mapById(null).id).toBe('classic');
    expect(mapById('orbits').id).toBe('orbits');
  });
});

describe('validateMap', () => {
  it('catches ids that do not match position in the circuit', () => {
    const map = clone(CLASSIC_MAP);
    map.tiles[5].id = 99;
    expect(problemText(map)).toMatch(/ids must match position/);
  });

  it('catches a missing anchor the rules resolve by role', () => {
    const map = clone(CLASSIC_MAP);
    map.tiles = map.tiles.filter((t) => t.type !== 'jail');
    map.tiles.forEach((t, i) => { t.id = i; });
    expect(problemText(map)).toMatch(/no "jail" tile/);
  });

  it('catches a colour group that can never be completed', () => {
    const map = clone(CLASSIC_MAP);
    map.tiles[3].group = 'green';   // leaves brown with a single lot
    expect(problemText(map)).toMatch(/has only 1 lot/);
  });

  // Every lot in a group has to cost the same to build on, or even-building
  // stops meaning anything.
  it('catches a group whose lots disagree on the house cost', () => {
    const map = clone(CLASSIC_MAP);
    map.tiles[1].houseCost = 999;
    expect(problemText(map)).toMatch(/mixes house costs/);
  });

  /**
   * A map can only say a lot must charge *something*. How many tiers it needs is
   * a question about the game's build ladder — a board with skyscrapers wants
   * seven where the classic one wants six — and a map has no economy, so that
   * half of the check lives in `validateGame`.
   */
  it('catches a property with no rent ladder', () => {
    const map = clone(CLASSIC_MAP);
    delete map.tiles[1].rent;
    expect(problemText(map)).toMatch(/at least two rent tiers/);
  });

  it('catches a railroad with no price and a tax with no amount', () => {
    const map = clone(CLASSIC_MAP);
    delete map.tiles[5].price;
    delete map.tiles[4].amount;
    const text = problemText(map);
    expect(text).toMatch(/railroad with no price/);
    expect(text).toMatch(/tax tile with no amount/);
  });

  it('catches a tile count that cannot make the shape it asked for', () => {
    const map = clone(CLASSIC_MAP);
    map.tiles = map.tiles.slice(0, 39);
    expect(problemText(map)).toMatch(/needs 4n \+ 4 tiles, not 39/);
  });

  it('catches rings that do not add up to the circuit', () => {
    const map = clone(ORBIT_MAP);
    map.layout = { kind: 'rings', rings: [{ count: 10, radius: 200 }] };
    expect(problemText(map)).toMatch(/rings hold 10 tiles but it has 30/);
  });

  it('catches rings drawn so close together they would overlap', () => {
    const map = clone(ORBIT_MAP);
    map.layout = {
      kind: 'rings', depth: 62,
      rings: [{ count: 15, radius: 200 }, { count: 15, radius: 210 }],
    };
    expect(problemText(map)).toMatch(/closer than a tile is deep/);
  });

  // The shipped decks are written for the classic board, so a shorter map has
  // cards pointing past its last tile. They must do nothing rather than wrap
  // onto an unrelated square — see ROADMAP 8b for decks belonging to a map.
  it('leaves a card that names a tile the map does not have doing nothing', () => {
    const board = new Board(ROUND_MAP);
    const bank = new Bank();
    const player = new Player('p1', 'Ann', 'car');
    const effects = new CardEffects(board, bank, [player]);

    player.position = 3;
    effects.execute(
      { id: 'x', description: 'Advance to Boardwalk.', action: { type: 'advanceTo', tile: 39 } },
      player,
    );
    expect(player.position).toBe(3);
  });

  it('accepts a minimal hand-written map', () => {
    const tiles: TileDefinition[] = [
      { id: 0, type: 'go', name: 'GO' },
      { id: 1, type: 'jail', name: 'Jail' },
      { id: 2, type: 'chance', name: 'Chance' },
      { id: 3, type: 'freeParking', name: 'Rest' },
    ];
    const map: GameMap = {
      id: 'tiny', name: 'Tiny', blurb: 'four tiles', tiles, layout: { kind: 'ring' },
    };
    expect(problemText(map)).toBe('');
    expect(new Board(map).size).toBe(4);
  });
});
