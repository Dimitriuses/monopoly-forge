import { describe, it, expect, afterEach } from 'vitest';
import {
  deriveMap, replacingTypes, withoutCards, portableCards,
  validateGame, loadGame, unloadGame,
  CLASSIC_GAME, POCKET_GAME, rulesFor, type Game,
} from '@/games';
import { CLASSIC_MAP } from '@/maps';
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { Board } from '@/game/Board';

// ─── Composing a game out of one that exists ──────────────────────────────────

describe('deriveMap', () => {
  it('keeps the length and the ids, whatever the swap does', () => {
    const derived = deriveMap(CLASSIC_MAP, {
      id: 'derived', name: 'Derived',
      // A swap that "forgets" the id entirely — it is forced back on, because a
      // renumbered circuit breaks every card that names a square.
      swap: () => ({ id: 999, type: 'freeParking', name: 'Nowhere' }),
    });

    expect(derived.tiles).toHaveLength(CLASSIC_MAP.tiles.length);
    expect(derived.tiles.map((t) => t.id)).toEqual(CLASSIC_MAP.tiles.map((_, i) => i));
  });

  it('leaves the original alone', () => {
    const before = JSON.stringify(CLASSIC_MAP);
    deriveMap(CLASSIC_MAP, {
      id: 'x', name: 'X',
      swap: replacingTypes(['utility'], (t) => ({ ...t, type: 'chance' })),
    });
    expect(JSON.stringify(CLASSIC_MAP)).toBe(before);
  });

  it('inherits the shape and the blurb unless they are given', () => {
    const derived = deriveMap(CLASSIC_MAP, { id: 'x', name: 'X' });
    expect(derived.layout).toEqual(CLASSIC_MAP.layout);
    expect(derived.blurb).toBe(CLASSIC_MAP.blurb);
  });
});

describe('replacingTypes', () => {
  it('swaps only the types named', () => {
    const swap = replacingTypes(['utility'], (tile) => ({
      id: tile.id, type: 'communityChest', name: 'Community Chest',
    }));
    const derived = deriveMap(CLASSIC_MAP, { id: 'x', name: 'X', swap });

    expect(derived.tiles.some((t) => t.type === 'utility')).toBe(false);
    // ...and nothing else moved.
    const kinds = (map: typeof CLASSIC_MAP) =>
      map.tiles.filter((t) => t.type === 'property' || t.type === 'railroad').length;
    expect(kinds(derived)).toBe(kinds(CLASSIC_MAP));
  });

  it('is still a board the engine will build', () => {
    const derived = deriveMap(CLASSIC_MAP, {
      id: 'x', name: 'X',
      swap: replacingTypes(['utility'], (t) => ({ id: t.id, type: 'chance', name: 'Chance' })),
    });
    expect(new Board(derived).size).toBe(40);
  });
});

describe('withoutCards', () => {
  it('takes the named cards out and leaves the rest', () => {
    const trimmed = withoutCards(CHANCE_CARDS, 'ch2', 'ch5');
    expect(trimmed).toHaveLength(CHANCE_CARDS.length - 2);
    expect(trimmed.some((c) => c.id === 'ch2' || c.id === 'ch5')).toBe(false);
  });

  // A typo that silently removes nothing is worse than one that stops the build.
  it('refuses an id the deck does not have', () => {
    expect(() => withoutCards(CHANCE_CARDS, 'ch99'))
      .toThrow(/no card called ch99/);
  });

  it('leaves the original deck alone', () => {
    const before = CHANCE_CARDS.length;
    withoutCards(CHANCE_CARDS, 'ch1');
    expect(CHANCE_CARDS).toHaveLength(before);
  });
});

describe('portableCards', () => {
  it('keeps only the cards that name no place', () => {
    const portable = portableCards(CHANCE_CARDS);
    expect(portable.length).toBeLessThan(CHANCE_CARDS.length);
    expect(portable.every((c) => {
      const type = (c.action as { type: string }).type;
      return type !== 'advanceTo' && type !== 'advanceToNearest';
    })).toBe(true);
  });
});

// ─── The example the authoring guide is written around ────────────────────────

describe('Pocket', () => {
  afterEach(() => { unloadGame(); });

  it('is the classic board with the utilities swapped out', () => {
    expect(POCKET_GAME.map.tiles).toHaveLength(CLASSIC_MAP.tiles.length);
    expect(POCKET_GAME.map.tiles.some((t) => t.type === 'utility')).toBe(false);
    expect(CLASSIC_MAP.tiles.filter((t) => t.type === 'utility')).toHaveLength(2);
  });

  it('validates, and is decided by a round limit', () => {
    loadGame(POCKET_GAME);
    expect(validateGame(POCKET_GAME)).toEqual([]);
    expect(POCKET_GAME.rules?.winCondition).toBe('roundLimit');
    expect(POCKET_GAME.rules?.roundLimit).toBe(40);
  });

  // A game can turn a *house rule* on, which it could not until M9b: the menu
  // sent all three booleans explicitly every time, so its `false` beat the
  // game's `true` and Pocket silently played without the jackpot it asks for.
  it('turns the Free Parking jackpot on, and the rule set agrees', () => {
    expect(POCKET_GAME.rules?.freeParkingJackpot).toBe(true);
    expect(rulesFor(POCKET_GAME).freeParkingJackpot).toBe(true);
    // ...and a player who says otherwise still wins.
    expect(rulesFor(POCKET_GAME, { freeParkingJackpot: false }).freeParkingJackpot).toBe(false);
  });

  // The claim the authoring guide makes, checked rather than asserted: take the
  // utilities out and the *classic* deck stops being valid next to the board,
  // because one of its cards advances to the nearest utility.
  it('would be refused with the untrimmed classic deck', () => {
    const untrimmed: Game = {
      ...POCKET_GAME,
      cards: { chance: CHANCE_CARDS, community: COMMUNITY_CHEST_CARDS },
    };
    loadGame(untrimmed);
    const problems = validateGame(untrimmed);

    expect(problems.some((p) => /nearest "utility", and this board has none/.test(p.problem)))
      .toBe(true);
  });

  it('brings artwork under keys the renderer already asks for', () => {
    // A game supplies a texture by replacing one — there is no second lookup
    // path in the renderer, which is why the keys have to be the existing ones.
    expect(Object.keys(POCKET_GAME.assets ?? {})).toEqual(['house', 'hotel']);
    for (const url of Object.values(POCKET_GAME.assets ?? {})) {
      expect(url, 'assets are imported, not written as paths').toEqual(expect.any(String));
    }
  });

  it('is the only shipped game that brings any', () => {
    // The default is no assets at all, and that is what keeps the repo free of
    // third-party art. If a second game grows some, that is a decision, not a
    // drift — and this test is where it gets noticed.
    expect(CLASSIC_GAME.assets).toBeUndefined();
  });
});
