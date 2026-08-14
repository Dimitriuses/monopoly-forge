import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bus } from '@/utils/EventBus';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Dice } from '@/game/Dice';
import { Player } from '@/game/Player';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import {
  captureGame, restoreGame, validateSnapshot, SNAPSHOT_VERSION, type GameParts,
} from '@/game/Snapshot';
import { registerVariant, variantNamed, VARIANTS } from '@/game/Variants';
import { unloadGame } from '@/games/scope';
import { rng } from '@/utils/PRNG';
import { Auction } from '@/game/Auction';

// ─── A save taken mid-turn ────────────────────────────────────────────────────
// A restore used to call `startTurn()` whatever had been saved, which threw the
// middle of a turn away — and is why saving was refused any time one was in
// progress. What is checked here is that the middle of a turn survives the round
// trip, and that picking it up again does not re-run what already happened.

function parts(over: Partial<GameParts> = {}): GameParts {
  const board = new Board();
  const bank  = new Bank(board.rules);
  const dice  = new Dice();
  const players = [
    new Player('p1', 'Ann', 'car', false, 1500),
    new Player('p2', 'Bo',  'dog', false, 1500),
  ];
  return {
    gameId: 'classic',
    board, bank, dice, players,
    turnManager: new TurnManager(players, board, dice),
    chanceDeck:  new CardDeck(CHANCE_CARDS),
    commDeck:    new CardDeck(COMMUNITY_CHEST_CARDS),
    cardEffects: new CardEffects(board, bank, players),
    rules: board.rules,
    ...over,
  };
}

beforeEach(() => { bus.clear(); rng.seed(1); });
afterEach(() => { bus.clear(); unloadGame(); });

describe('the snapshot carries where in the turn it was', () => {
  it('bumped its version, because the shape changed', () => {
    expect(SNAPSHOT_VERSION).toBe(9);
  });

  it('records the phase, not just whose turn it is', () => {
    const p = parts();
    p.turnManager.startTurn();
    p.turnManager.rollDice();

    const snap = captureGame(p);
    expect(snap.turn.phase).toBeTruthy();
    expect(snap.turn.currentPlayerIndex).toBe(0);
  });

  it('round-trips a turn that was waiting for a roll', () => {
    const p = parts();
    p.turnManager.startTurn();

    const restored = restoreGame(captureGame(p));
    expect(restored.resumedPhase).toBe('WAITING_FOR_ROLL');
    expect(restored.turnManager.phase).toBe('WAITING_FOR_ROLL');
    expect(restored.pendingLanding).toBe(false);
  });

  it('round-trips a walk whose landing is still owed', () => {
    const p = parts();
    p.turnManager.startTurn();
    p.players[0].position = 12;

    const snap = captureGame({ ...p, pendingLanding: true });
    expect(snap.turn.pendingLanding).toBe(true);

    const restored = restoreGame(snap);
    expect(restored.pendingLanding).toBe(true);
    // The model is already at the destination: a restore owes the *landing*,
    // never the walk, which is what stops the salary being paid twice.
    expect(restored.players[0].position).toBe(12);
  });

  it('round-trips a held turn', () => {
    const p = parts();
    p.turnManager.startTurn();
    p.turnManager.restorePhase({ phase: 'END_TURN', held: true });

    const restored = restoreGame(captureGame(p));
    expect(restored.turnManager.phase).toBe('END_TURN');
    expect(restored.turnManager.isHeld).toBe(true);
  });

  it('keeps the round and who has played in it', () => {
    const p = parts();
    p.turnManager.startTurn();
    p.turnManager.endTurn();
    p.turnManager.startTurn();

    const before = captureGame(p);
    const restored = restoreGame(before);
    expect(restored.turnManager.round).toBe(before.turn.round);
    expect(captureGame(restored).turn.seatsThisRound.sort())
      .toEqual(before.turn.seatsThisRound.sort());
  });

  it('still validates', () => {
    const p = parts();
    p.turnManager.startTurn();
    expect(validateSnapshot(captureGame(p) as unknown as Record<string, unknown>)).toBe(true);
  });
});

describe('restorePhase — putting the turn back, not replaying it', () => {
  /**
   * The trap this exists to avoid: `enterPhase` runs a phase's `onEnter`, which
   * is what *happens* when you arrive. A restore that arrived a second time
   * would run a variant's extra move again — the speed die's bonus walk twice
   * over, from a save taken while the first one was on screen.
   */
  it('does not run the phase’s onEnter', () => {
    let entered = 0;
    registerVariant('countingPhase', {
      label: 'Counting',
      apply: (flow) => flow.insertAfter('AWAITING_BUY_DECISION', {
        name: 'COUNTED', onEnter: () => { entered++; },
      }),
    });

    const board = new Board(undefined, { variants: ['countingPhase'] });
    const bank = new Bank(board.rules);
    const dice = new Dice();
    const players = [new Player('p1', 'Ann', 'car', false, 1500),
                     new Player('p2', 'Bo', 'dog', false, 1500)];
    const turns = new TurnManager(players, board, dice);

    turns.startTurn();
    turns.endTurn();                       // walks through COUNTED once
    expect(entered).toBe(1);

    turns.restorePhase({ phase: 'COUNTED', held: true });
    expect(entered).toBe(1);               // …and not again
    expect(turns.phase).toBe('COUNTED');
    expect(turns.isHeld).toBe(true);

    VARIANTS.delete('countingPhase');
  });

  it('leaves the turn resumable rather than already ended', () => {
    const p = parts();
    p.turnManager.startTurn();
    p.turnManager.restorePhase({ phase: 'END_TURN', held: true });

    let ended = false;
    bus.on('turn:end', () => { ended = true; });
    p.turnManager.resume();
    expect(ended).toBe(true);
  });

  it('counts the restored seat as having played this round', () => {
    const p = parts();
    p.turnManager.restorePhase({ phase: 'WAITING_FOR_ROLL', held: false });
    expect(captureGame(p).turn.seatsThisRound).toContain('p1');
  });
});

describe('a resumed game plays on identically', () => {
  /**
   * The PRNG's *position* is saved, not its seed — so the next roll after a
   * restore is the roll the saved game would have made. Saving mid-turn must not
   * change that.
   */
  it('rolls what the saved game would have rolled', () => {
    const p = parts();
    p.turnManager.startTurn();
    p.turnManager.rollDice();

    const snap = captureGame({ ...p, pendingLanding: true });

    // Carry on in the original…
    const original = p.dice.roll();
    // …and in a restore of it.
    const restored = restoreGame(snap);
    expect(restored.dice.roll()).toEqual(original);
  });

  it('brings the dice back as they were, including the variant’s', () => {
    const board = new Board(undefined, { variants: ['speedDie'] });
    const p = parts({ board, rules: board.rules });
    p.turnManager.startTurn();
    p.turnManager.rollDice();

    const restored = restoreGame(captureGame(p));
    expect(restored.dice.lastResult).toEqual(p.dice.lastResult);
    expect(variantNamed('speedDie').dice).toBeTruthy();
  });
});

// ─── An auction ───────────────────────────────────────────────────────────────

describe('an auction survives a save', () => {
  const subject = { kind: 'tile', id: 39, label: 'Boardwalk' };

  function table(): Player[] {
    return [
      new Player('p1', 'Ann', 'car', false, 1500),
      new Player('p2', 'Bo',  'dog', false, 1500),
      new Player('p3', 'Cy',  'iron', false, 1500),
    ];
  }

  it('captures what is under the hammer and who is still in', () => {
    const players = table();
    const auction = new Auction(subject, players, 10);
    auction.bid('p1', 50);
    auction.pass('p2');

    const saved = auction.capture();
    expect(saved.highBid).toBe(50);
    expect(saved.highBidderId).toBe('p1');
    expect(saved.bidderIds).toEqual(['p1', 'p3']);   // Bo passed, and is out for good
  });

  it('comes back bidding against the same people, at the same price', () => {
    const players = table();
    const auction = new Auction(subject, players, 10);
    auction.bid('p1', 50);
    auction.pass('p2');

    const restored = Auction.restore(auction.capture(), players);
    expect(restored.highBid).toBe(50);
    expect(restored.minimumBid).toBe(60);
    expect(restored.bidders.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(restored.currentBidder?.id).toBe(auction.currentBidder?.id);
    expect(restored.complete).toBe(false);
  });

  /** The bidders must be the *same objects*, or bidding settles against cash
   *  nobody actually has. */
  it('bids against the restored table, not copies of it', () => {
    const players = table();
    const auction = new Auction(subject, players, 10);
    const restored = Auction.restore(auction.capture(), players);
    expect(restored.bidders[0]).toBe(players[0]);
  });

  it('does not reopen one the standing bid had already decided', () => {
    const players = table();
    const auction = new Auction(subject, players, 10);
    auction.bid('p1', 50);
    auction.pass('p2');
    auction.pass('p3');
    expect(auction.complete).toBe(true);

    expect(Auction.restore(auction.capture(), players).complete).toBe(true);
  });

  it('drops a bidder who is no longer at the table rather than faking one', () => {
    const players = table();
    const auction = new Auction(subject, players, 10);
    const saved = auction.capture();

    const restored = Auction.restore(saved, players.slice(0, 2));
    expect(restored.bidders.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(restored.currentBidder).not.toBeNull();
  });

  it('round-trips through the game snapshot, queue and all', () => {
    const p = parts();
    p.turnManager.startTurn();
    const auction = new Auction(subject, p.players, 10);
    auction.bid('p1', 70);

    const snap = captureGame({
      ...p,
      auction: {
        live: auction.capture(),
        queue: [{ kind: 'tile', id: 1, label: 'Mediterranean Ave' }],
        endsTurn: true,
        contention: null,
      },
    });
    expect(snap.auction?.live?.highBid).toBe(70);

    const restored = restoreGame(snap);
    expect(restored.auction?.queue).toHaveLength(1);
    expect(restored.auction?.endsTurn).toBe(true);

    const back = Auction.restore(restored.auction!.live!, restored.players);
    expect(back.highBid).toBe(70);
    expect(back.highBidderId).toBe('p1');
  });

  it('saves nothing when nothing is under the hammer', () => {
    const p = parts();
    p.turnManager.startTurn();
    expect(captureGame(p).auction).toBeNull();
  });
});
