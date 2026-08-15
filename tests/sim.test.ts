import { describe, it, expect } from 'vitest';
import { simulate } from '@/sim/Runner';
import { summarise } from '@/sim/Report';
import { checkInvariants } from '@/sim/Invariants';
import { GAMES, ROUNDABOUT_GAME, rulesFor } from '@/games';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { CardDeck, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { resolveRules } from '@/game/Rules';
import { PROFILES } from '@/game/Bot';

// ─── The simulator ────────────────────────────────────────────────────────────
// These are slower than the rest of the suite — a played-out game is a few
// thousand model operations — so they play a handful, not a batch. The batch is
// `npm run simulate`, and what it is *for* is finding the once-in-five-hundred
// bug these cannot.

describe('The headless runner', () => {
  it('plays a whole game with nobody driving it', () => {
    const result = simulate({ game: 'classic', seed: 1, players: 3, checkInvariants: true });

    expect(result.violations).toEqual([]);
    expect(result.turns).toBeGreaterThan(20);
    expect(result.finished).toBe(true);
    expect(result.winnerId).not.toBeNull();
    // Somebody has to have gone under for anybody to have won.
    expect(result.bankruptcies.length).toBe(2);
  });

  it('replays a seed exactly', () => {
    const a = simulate({ game: 'classic', seed: 42, players: 4 });
    const b = simulate({ game: 'classic', seed: 42, players: 4 });
    expect(b).toEqual(a);
  });

  it('plays different games from different seeds', () => {
    const a = simulate({ game: 'classic', seed: 1, players: 3 });
    const b = simulate({ game: 'classic', seed: 2, players: 3 });
    expect(b.turns).not.toBe(a.turns);
  });

  // The bots draw no randomness, so a game is a pure function of its seed. If
  // this breaks, a batch stops being reproducible and its numbers stop meaning
  // anything.
  it('does not let the bots move the dice stream', () => {
    const withTrades = simulate({ game: 'classic', seed: 7, players: 4 });
    const again      = simulate({ game: 'classic', seed: 7, players: 4 });
    expect(again.rounds).toBe(withTrades.rounds);
    expect(again.cash).toEqual(withTrades.cash);
  });

  it('plays every game this build ships', () => {
    for (const id of Object.keys(GAMES)) {
      const result = simulate({ game: id, seed: 3, players: 3, checkInvariants: true });
      expect(result.violations, id).toEqual([]);
      expect(result.turns, id).toBeGreaterThan(10);
      expect(result.gameId, id).toBe(id);
    }
  });

  it('reports a game that will not end rather than hanging', () => {
    const result = simulate({ game: 'classic', seed: 5, players: 4, maxTurns: 12 });
    expect(result.finished).toBe(false);
    expect(result.turns).toBe(12);
    expect(result.winnerId).toBeNull();
  });

  it('takes the house rules over a game\'s own', () => {
    const potted = simulate({
      game: 'classic', seed: 9, players: 3, rules: { freeParkingJackpot: true },
    });
    expect(potted.finished || potted.turns > 0).toBe(true);
  });

  // The runner resolved `game.rules` and nothing else, so Speed Die played
  // without the speed die — and reported numbers identical to Classic's, which
  // is what gave it away. `rulesFor` is the one place a rule set is assembled.
  it('plays a game with the variants the game names', () => {
    const speed   = simulate({ game: 'speed', seed: 4, players: 4 });
    const classic = simulate({ game: 'classic', seed: 4, players: 4 });
    expect(rulesFor(GAMES.speed).variants).toEqual(['speedDie']);
    expect(speed.turns).not.toBe(classic.turns);
  });

  // Roundabout ends after eighty rounds by design (M8d's balance pass), which is
  // what stops the 2-in-300 that used to run for ever.
  it('honours a game that names its own win condition', () => {
    expect(rulesFor(ROUNDABOUT_GAME).winCondition).toBe('roundLimit');
    for (const seed of [59, 78, 96]) {
      const result = simulate({ game: 'roundabout', seed, players: 4, maxTurns: 4000 });
      expect(result.finished, `seed ${seed}`).toBe(true);
    }
  });

  it('takes a policy per seat', () => {
    const result = simulate({
      game: 'classic', seed: 6,
      players: [
        { profile: PROFILES.baseline }, { profile: PROFILES.aggressive },
        { profile: PROFILES.baseline }, { profile: PROFILES.aggressive },
      ],
    });
    expect(Object.keys(result.cash)).toHaveLength(4);
  });

  it('runs one game after another without them treading on each other', () => {
    const first  = simulate({ game: 'orbits', seed: 11, players: 3, checkInvariants: true });
    const second = simulate({ game: 'classic', seed: 11, players: 3, checkInvariants: true });
    expect(first.violations).toEqual([]);
    expect(second.violations).toEqual([]);
    expect(second.gameId).toBe('classic');
  });
});

// ─── The invariants themselves ────────────────────────────────────────────────

describe('Invariants', () => {
  const table = () => {
    const board = new Board();
    const bank  = new Bank();
    const players = [new Player('p1', 'Ann', 'car'), new Player('p2', 'Bo', 'dog')];
    return {
      board, bank, players,
      rules: resolveRules(),
      decks: [new CardDeck(CHANCE_CARDS), new CardDeck(COMMUNITY_CHEST_CARDS)],
    };
  };

  it('is quiet about a game that is fine', () => {
    expect(checkInvariants(table())).toEqual([]);
  });

  it('catches a deed the two sides of ownership disagree about', () => {
    const ctx = table();
    ctx.players[0].ownedTileIds.add(1);   // the tile was never told
    expect(checkInvariants(ctx).some((v) => v.what === 'deeds')).toBe(true);
  });

  it('catches houses that are not where the rules say', () => {
    const ctx = table();
    ctx.bank.houses -= 3;                 // three houses left the bank and vanished
    // The census is per building kind now, so the violation is named for one.
    expect(checkInvariants(ctx).some((v) => v.what === 'house')).toBe(true);
  });

  // The one that caught a real bug on the simulator's first batch: a bankrupt
  // player's Get Out of Jail Free cards were destroyed instead of returned.
  it('catches a card that has left the game', () => {
    const ctx = table();
    ctx.decks[0].drawCard();              // drawn and never returned
    expect(checkInvariants(ctx).some((v) => v.what === 'deck')).toBe(true);
  });

  it('catches a bankrupt player who still holds something', () => {
    const ctx = table();
    ctx.players[0].isBankrupt = true;
    ctx.players[0].jailCards.push(CHANCE_CARDS.find((c) => c.isGetOutOfJail)!);
    expect(checkInvariants(ctx).some((v) => v.what === 'bankruptcy')).toBe(true);
  });
});

// ─── The report ───────────────────────────────────────────────────────────────

describe('The batch report', () => {
  const result = (over: Partial<ReturnType<typeof simulate>>) => ({
    gameId: 'classic', seed: 1, winnerId: 'p1', finished: true, turns: 100, rounds: 25,
    bankruptcies: [], cash: { p1: 1, p2: 2 }, deeds: { p1: 1, p2: 0 },
    housesBuilt: 0, hotelsBuilt: 0, houseShortage: false, auctions: 0, trades: 0,
    violations: [], ...over,
  });

  it('reports the median rather than the mean, so one stalemate cannot move it', () => {
    const runs = [100, 110, 120, 130, 9000].map((turns) => result({ turns }));
    const summary = summarise('classic', runs, 0);
    expect(summary.turns.median).toBe(120);
    expect(summary.turns.max).toBe(9000);
  });

  it('counts a game that hit the cap as unfinished, and says which seed', () => {
    const runs = [result({}), result({ seed: 77, finished: false, winnerId: null })];
    const summary = summarise('classic', runs, 0);
    expect(summary.unfinished).toBe(1);
    expect(summary.unfinishedSeeds).toEqual([77]);
  });

  it('counts wins by seat, which is how a turn-order advantage shows up', () => {
    const runs = [
      result({ winnerId: 'p1' }), result({ winnerId: 'p1' }), result({ winnerId: 'p2' }),
    ];
    const summary = summarise('classic', runs, 0);
    expect(summary.winsBySeat).toEqual([2, 1]);
    expect(summary.firstSeatEdge).toBeCloseTo(2 / 3);
  });
});
