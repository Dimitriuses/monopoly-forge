import { describe, it, expect, afterEach } from 'vitest';
import {
  GAMES, DEFAULT_GAME, gameById, validateGame, decksFor,
  loadGame, unloadGame, loadedGame,
  CLASSIC_GAME, ROUNDABOUT_GAME, ORBITS_GAME, SPEED_GAME,
  type Game,
} from '@/games';
import { Board } from '@/game/Board';
import { resolveRules } from '@/game/Rules';
import { knownTileTypes, isKnownTileType, createTile, registerTileType } from '@/tiles/registry';
import { knownCardEffects, registerCardEffect } from '@/cards/effects';
import { knownVariants, registerVariant } from '@/game/Variants';
import { Tile, type TileDefinition } from '@/tiles/Tile';
import { CHANCE_CARDS } from '@/cards/CardDeck';

describe('Games', () => {
  afterEach(() => { unloadGame(); });

  it('ships five, and every one of them validates', () => {
    expect(Object.keys(GAMES)).toEqual(['classic', 'roundabout', 'speed', 'orbits', 'pocket']);
    for (const game of Object.values(GAMES)) {
      loadGame(game);
      expect(validateGame(game), game.id).toEqual([]);
    }
  });

  it('is a board, an economy, a deck and a palette in one choice', () => {
    expect(ROUNDABOUT_GAME.map.id).toBe('round');
    expect(ROUNDABOUT_GAME.rules?.goSalary).toBe(150);
    expect(decksFor(ROUNDABOUT_GAME).chance[0].id).toMatch(/^gch/);
    expect(ORBITS_GAME.theme).toBe('parchment');
  });

  // Two games, one board, one field apart — which is the whole point of a bundle.
  it('lets two games share a board and differ in one field', () => {
    expect(SPEED_GAME.map).toBe(CLASSIC_GAME.map);
    expect(SPEED_GAME.variants).toEqual(['speedDie']);
    expect(CLASSIC_GAME.variants).toBeUndefined();
  });

  it('falls back to the classic game rather than refusing to start', () => {
    expect(gameById('backgammon').id).toBe(DEFAULT_GAME.id);
    expect(gameById(null).id).toBe(DEFAULT_GAME.id);
    expect(gameById('orbits').id).toBe('orbits');
  });

  it('loads a game before handing it back, so its board can be built', () => {
    const game = gameById('roundabout');
    expect(loadedGame()?.id).toBe('roundabout');
    // The proof that loading was enough: a board made of that game's tiles.
    expect(new Board(game.map, resolveRules(game.rules)).size).toBe(24);
  });

  // ─── Validation ─────────────────────────────────────────────────────────────

  describe('validation', () => {
    const withMap = (over: Partial<Game>): Game => ({ ...CLASSIC_GAME, ...over });

    it('refuses a deck that names a tile the board does not have', () => {
      const short = withMap({
        map: { ...CLASSIC_GAME.map, tiles: CLASSIC_GAME.map.tiles.slice(0, 24) },
        cards: { chance: CHANCE_CARDS, community: [] },
      });
      const problems = validateGame(short);
      expect(problems.some((p) => /does not have/.test(p.problem))).toBe(true);
    });

    it('refuses a rule set naming a strategy nobody registered', () => {
      const odd = withMap({ rules: { winCondition: 'mostHotels' } });
      expect(validateGame(odd).some((p) => /win condition "mostHotels"/.test(p.problem)))
        .toBe(true);
    });

    it('refuses a variant nobody registered', () => {
      const odd = withMap({ variants: ['teleportDie'] });
      expect(validateGame(odd).some((p) => /variant "teleportDie"/.test(p.problem)))
        .toBe(true);
    });

    // Board coherence is `validateMap`'s job and still is — a game inherits it.
    it('still refuses an incoherent board', () => {
      const broken = withMap({
        map: { ...CLASSIC_GAME.map, tiles: CLASSIC_GAME.map.tiles.filter((t) => t.type !== 'jail') },
      });
      expect(validateGame(broken).some((p) => /"jail"/.test(p.problem))).toBe(true);
    });
  });

  // ─── Scoped registration ────────────────────────────────────────────────────
  //
  // The reason M9a runs before the simulator: every registry is a singleton, and
  // a batch runner loads several games into one process. Two games that each
  // register a `tollBooth` must not get each other's.

  describe('scoped registration', () => {
    class TollBoothTile extends Tile {
      onLand(): void {}
    }

    const gameWith = (id: string, register: () => void): Game =>
      ({ ...CLASSIC_GAME, id, register });

    it('puts a game\'s own registrations in force', () => {
      const tolls = gameWith('tolls', () => {
        registerTileType('tollBooth', (def) => new TollBoothTile(def));
      });
      expect(isKnownTileType('tollBooth')).toBe(false);

      loadGame(tolls);
      expect(isKnownTileType('tollBooth')).toBe(true);
      expect(createTile({ id: 0, type: 'tollBooth', name: 'Toll' }))
        .toBeInstanceOf(TollBoothTile);
    });

    it('drops them when another game is loaded', () => {
      loadGame(gameWith('tolls', () => {
        registerTileType('tollBooth', (def) => new TollBoothTile(def));
      }));
      loadGame(CLASSIC_GAME);
      expect(isKnownTileType('tollBooth')).toBe(false);
    });

    // The one that would have produced a *wrong* simulation rather than a crash.
    it('does not let two games get each other\'s handler for one name', () => {
      const seen: string[] = [];
      const a = gameWith('a', () => registerCardEffect('audit', () => seen.push('a')));
      const b = gameWith('b', () => registerCardEffect('audit', () => seen.push('b')));

      loadGame(a);
      knownCardEffects();   // touch it, as a scene would
      loadGame(b);
      expect(knownCardEffects()).toContain('audit');

      loadGame(CLASSIC_GAME);
      expect(knownCardEffects()).not.toContain('audit');
    });

    it('scopes variants too, so a menu cannot offer a game its own', () => {
      loadGame(gameWith('busy', () => {
        registerVariant('extraInnings', { label: 'Extra innings' });
      }));
      expect(knownVariants()).toContain('extraInnings');

      loadGame(CLASSIC_GAME);
      expect(knownVariants()).not.toContain('extraInnings');
      expect(knownVariants()).toContain('speedDie');   // a built-in survives
    });

    it('leaves the built-ins alone', () => {
      const before = knownTileTypes().sort();
      loadGame(gameWith('tolls', () => {
        registerTileType('tollBooth', (def) => new TollBoothTile(def));
      }));
      unloadGame();
      expect(knownTileTypes().sort()).toEqual(before);
    });
  });
});
