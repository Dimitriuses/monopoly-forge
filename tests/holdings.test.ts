import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import {
  HOLDINGS, registerHolding, knownHoldings, describeHolding,
  countHeld, giveHolding, takeHolding, heldByPlayer, valueOfHoldings,
} from '@/game/Holdings';
import { settleDebt, liquidValue, estateValue } from '@/game/Estate';
import { captureGame, restoreGame, validateSnapshot } from '@/game/Snapshot';
import { checkInvariants } from '@/sim/Invariants';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { Dice } from '@/game/Dice';
import { TurnManager } from '@/game/TurnManager';
import { gameById } from '@/games';
import { winConditionNamed } from '@/game/TurnFlow';
import { unloadGame } from '@/games/scope';

// ─── Holdings ─────────────────────────────────────────────────────────────────
// A game giving a player something the engine has never heard of. The mechanism
// is small; what these check is the four things it must not get wrong, three of
// which this engine has already been bitten by.

let ann: Player;
let bo: Player;

beforeEach(() => {
  registerHolding('token', { label: 'token', value: 25 });
  registerHolding('capped', { label: 'capped thing', limit: 2 });
  registerHolding('bound', { label: 'bound thing', onBankruptcy: 'forfeit' });
  ann = new Player('p1', 'Ann', 'car', false, 1500);
  bo  = new Player('p2', 'Bo', 'dog', false, 1500);
});
afterEach(() => {
  for (const name of ['token', 'capped', 'bound']) HOLDINGS.delete(name);
  unloadGame();
});

describe('holding some of something', () => {
  it('starts with nothing', () => {
    expect(ann.holdings).toEqual({});
    expect(countHeld(ann, 'token')).toBe(0);
    expect(heldByPlayer(ann)).toEqual([]);
  });

  it('gives and takes, and reports how many actually moved', () => {
    expect(giveHolding(ann, 'token', 3)).toBe(3);
    expect(countHeld(ann, 'token')).toBe(3);
    expect(takeHolding(ann, 'token', 2)).toBe(2);
    expect(countHeld(ann, 'token')).toBe(1);
  });

  it('never goes below zero, and leaves no empty entry behind', () => {
    giveHolding(ann, 'token', 1);
    expect(takeHolding(ann, 'token', 5)).toBe(1);
    expect(countHeld(ann, 'token')).toBe(0);
    // An empty count would show up in the inventory as "0 tokens".
    expect(Object.keys(ann.holdings)).not.toContain('token');
  });

  it('respects a limit, and says how many it could take', () => {
    expect(giveHolding(ann, 'capped', 5)).toBe(2);
    expect(countHeld(ann, 'capped')).toBe(2);
    expect(giveHolding(ann, 'capped', 1)).toBe(0);
  });

  it('names them in the singular and the plural', () => {
    expect(describeHolding('token', 1)).toBe('1 token');
    expect(describeHolding('token', 3)).toBe('3 tokens');
    expect(describeHolding('nonesuch', 2)).toBe('2 × nonesuch');
  });

  it('prices a hand, so a bot can want one', () => {
    giveHolding(ann, 'token', 3);
    giveHolding(ann, 'capped', 1);   // no value declared, so worth nothing
    expect(valueOfHoldings(ann)).toBe(75);
  });

  /**
   * Checked through a real game rather than the fixture above, because the
   * baseline `loadGame` restores to is captured on the *first* load in a
   * process — so a kind registered before that first load is part of the
   * baseline and correctly survives. Ultimate registers its voucher from
   * `Game.register`, which is after.
   */
  it('is a scoped registry, like every other thing a game brings', () => {
    gameById('ultimate');
    expect(knownHoldings()).toContain('travelVoucher');
    gameById('classic');
    expect(knownHoldings()).not.toContain('travelVoucher');
  });
});

// ─── The four things it must not get wrong ────────────────────────────────────

describe('a holding survives a save', () => {
  function parts(players: Player[]) {
    const board = new Board();
    const bank  = new Bank(board.rules);
    const dice  = new Dice();
    return {
      gameId: 'classic', board, bank, dice, players,
      turnManager: new TurnManager(players, board, dice),
      chanceDeck: new CardDeck(CHANCE_CARDS),
      commDeck:   new CardDeck(COMMUNITY_CHEST_CARDS),
      cardEffects: new CardEffects(board, bank, players),
      rules: board.rules,
    };
  }

  it('round-trips through the snapshot', () => {
    giveHolding(ann, 'token', 2);
    const snap = captureGame(parts([ann, bo]));
    expect(snap.players[0].holdings).toEqual({ token: 2 });

    const restored = restoreGame(snap);
    expect(countHeld(restored.players[0], 'token')).toBe(2);
    expect(restored.players[1].holdings).toEqual({});
  });

  it('is copied, not shared, so a restore cannot write back into the save', () => {
    giveHolding(ann, 'token', 1);
    const snap = captureGame(parts([ann, bo]));
    const restored = restoreGame(snap);
    giveHolding(restored.players[0], 'token', 1);
    expect(snap.players[0].holdings).toEqual({ token: 1 });
  });

  /**
   * The rule a turn order already gets: a kind nothing registers cannot be
   * restored into anything, and half-restoring is how a resumed game comes back
   * quietly wrong.
   *
   * Asked of a *game's* own holding rather than the fixture's, because
   * `validateSnapshot` loads the game named in the save before checking what it
   * registers — which is the whole point, and means a kind registered outside a
   * game is not in force by the time the check runs.
   */
  it('accepts a holding the saved game registers', () => {
    const game = gameById('ultimate');
    const board = new Board(game.map, { movement: 'tracks' });
    giveHolding(ann, 'travelVoucher', 1);
    const snap = captureGame({ ...parts([ann, bo]), gameId: 'ultimate', board });
    expect(validateSnapshot(snap as unknown as Record<string, unknown>)).toBe(true);
  });

  it('refuses one naming a kind no game registers', () => {
    const snap = captureGame(parts([ann, bo])) as unknown as Record<string, unknown>;
    (snap.players as Array<{ holdings: Record<string, number> }>)[0].holdings = { ghost: 1 };
    expect(validateSnapshot(snap)).toBe(false);
  });
});

describe('a bankrupt player holds nothing', () => {
  const board = () => new Board();

  it('hands them to the creditor with the deeds', () => {
    const b = board();
    giveHolding(ann, 'token', 2);
    ann.cash = 0;

    const settlement = settleDebt(b, new Bank(b.rules), ann, bo, 5_000);
    expect(settlement.bankrupt).toBe(true);
    expect(countHeld(ann, 'token')).toBe(0);
    expect(countHeld(bo, 'token')).toBe(2);
    expect(settlement.actions.join()).toMatch(/2 tokens passed to Bo/);
  });

  it('forfeits a kind that says so, rather than passing it on', () => {
    const b = board();
    giveHolding(ann, 'bound', 1);
    ann.cash = 0;

    settleDebt(b, new Bank(b.rules), ann, bo, 5_000);
    expect(countHeld(ann, 'bound')).toBe(0);
    expect(countHeld(bo, 'bound')).toBe(0);
  });

  it('forfeits everything when the debt is owed to the bank', () => {
    const b = board();
    giveHolding(ann, 'token', 3);
    ann.cash = 0;

    settleDebt(b, new Bank(b.rules), ann, null, 5_000);
    expect(heldByPlayer(ann)).toEqual([]);
  });

  it('respects the receiver limit rather than overfilling them', () => {
    const b = board();
    giveHolding(ann, 'capped', 2);
    giveHolding(bo, 'capped', 1);
    ann.cash = 0;

    settleDebt(b, new Bank(b.rules), ann, bo, 5_000);
    expect(countHeld(ann, 'capped')).toBe(0);
    expect(countHeld(bo, 'capped')).toBe(2);   // the limit, not three
  });
});

describe('a holding is wealth, but it is not cash', () => {
  // The distinction `HoldingKind.value` exists for, and the one place getting it
  // wrong would be silent: a fire sale that counted a voucher would think a debt
  // coverable that is not, and clamp somebody out of a bankruptcy they are in.
  it('counts towards what a player is worth', () => {
    const b = new Board();
    giveHolding(ann, 'token', 2);
    expect(estateValue(b, ann)).toBe(liquidValue(b, ann) + 50);
  });

  it('does not count towards what a player can raise', () => {
    const b = new Board();
    const before = liquidValue(b, ann);
    giveHolding(ann, 'token', 4);
    expect(liquidValue(b, ann)).toBe(before);
  });

  it('decides a round-limited game, so the value is load-bearing', () => {
    const b = new Board(undefined, { winCondition: 'roundLimit', roundLimit: 1 });
    ann.cash = bo.cash = 1_500;
    giveHolding(bo, 'token', 3);   // $75 richer, and nothing else separates them

    const won = winConditionNamed('roundLimit')(
      { players: [ann, bo], board: b, round: 2, rules: b.rules },
    );
    expect(won?.winnerId).toBe(bo.id);
  });
});

describe('the batch counts them', () => {
  // The decks are part of the context every invariant shares, so the census over
  // the cards runs alongside the census over the holdings.
  const ctx = () => {
    const b = new Board();
    return {
      board: b, bank: new Bank(b.rules), players: [ann, bo], rules: b.rules,
      decks: [new CardDeck(CHANCE_CARDS), new CardDeck(COMMUNITY_CHEST_CARDS)],
    };
  };

  it('passes on a sane hand', () => {
    giveHolding(ann, 'token', 2);
    expect(checkInvariants(ctx())).toEqual([]);
  });

  it('catches a count over the limit for its kind', () => {
    ann.holdings.capped = 9;   // written directly, past the helper that clamps
    expect(checkInvariants(ctx()).map((v) => v.what)).toContain('holdings');
  });

  it('catches a kind nothing registered', () => {
    ann.holdings.ghost = 1;
    expect(checkInvariants(ctx())[0].detail).toMatch(/unregistered "ghost"/);
  });

  it('catches a bankrupt player still holding one', () => {
    giveHolding(ann, 'token', 1);
    ann.isBankrupt = true;
    expect(checkInvariants(ctx()).map((v) => v.what)).toContain('bankruptcy');
  });
});
