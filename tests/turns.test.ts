import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { Dice, type DiceResult } from '@/game/Dice';
import { TurnManager } from '@/game/TurnManager';
import { bus } from '@/utils/EventBus';

/** A Dice whose faces are dictated by the test rather than the PRNG. */
class ScriptedDice extends Dice {
  private script: Array<[number, number]>;

  constructor(script: Array<[number, number]>) {
    super();
    this.script = script;
  }

  override roll(): DiceResult {
    const [die1, die2] = this.script.shift() ?? [1, 2];
    this.lastResult = { die1, die2, isDoubles: die1 === die2, total: die1 + die2 };
    return this.lastResult;
  }
}

describe('TurnManager', () => {
  let board: Board;
  let players: Player[];
  let events: Array<{ name: string; payload: Record<string, unknown> }>;

  /** bus.clear() must run *before* the TurnManager is built — its constructor
   *  registers the jail:enter listener that the game depends on. */
  const build = (script: Array<[number, number]>) => {
    bus.clear();
    board = new Board();
    players = [
      new Player('p1', 'Ann', 'car'),
      new Player('p2', 'Bo', 'dog'),
      new Player('p3', 'Cy', 'iron'),
    ];
    const dice = new ScriptedDice(script);
    const tm = new TurnManager(players, board, dice);

    events = [];
    for (const name of ['player:move', 'jail:enter', 'jail:exit', 'jail:stay', 'turn:start', 'turn:end', 'game:end']) {
      bus.on(name, (payload: Record<string, unknown>) => events.push({ name, payload }));
    }
    return { tm, dice };
  };

  beforeEach(() => {
    bus.clear();
  });

  describe('rolling and moving', () => {
    it('moves the active player by the dice total', () => {
      const { tm } = build([[3, 4]]);
      tm.startTurn();
      tm.rollDice();

      expect(players[0].position).toBe(7);
      expect(events.find((e) => e.name === 'player:move')!.payload)
        .toMatchObject({ playerId: 'p1', from: 0, to: 7, steps: 7 });
    });

    it('ignores a roll unless the turn is waiting for one', () => {
      const { tm } = build([[3, 4], [2, 2]]);
      tm.startTurn();
      tm.rollDice();          // phase is now MOVING
      const positionAfterFirst = players[0].position;
      tm.rollDice();          // must be a no-op
      expect(players[0].position).toBe(positionAfterFirst);
    });

    it('pays the GO salary when the move wraps the board', () => {
      const { tm } = build([[3, 4]]);
      players[0].position = 36;
      const salaries: Array<Record<string, unknown>> = [];
      bus.on('rent:pay', (p: Record<string, unknown>) => { if (p.reason === 'go') salaries.push(p); });

      tm.startTurn();
      tm.rollDice();

      expect(players[0].position).toBe(3);
      expect(salaries).toHaveLength(1);
      expect(salaries[0]).toMatchObject({ creditorId: 'p1', amount: 200 });
    });
  });

  describe('doubles', () => {
    it('sends a player to jail on the third consecutive double', () => {
      const { tm } = build([[2, 2], [3, 3], [4, 4]]);

      tm.startTurn(); tm.rollDice();
      expect(players[0].inJail).toBe(false);
      tm.startTurn(); tm.rollDice();
      expect(players[0].inJail).toBe(false);
      tm.startTurn(); tm.rollDice();

      expect(players[0].inJail).toBe(true);
      expect(players[0].position).toBe(10);
      expect(players[0].doublesStreak).toBe(0);
      expect(events.some((e) => e.name === 'jail:enter' && e.payload.reason === 'doubles')).toBe(true);
    });

    it('does not move the player on the jailing roll', () => {
      const { tm } = build([[2, 2], [3, 3], [4, 4]]);
      for (let i = 0; i < 3; i++) { tm.startTurn(); tm.rollDice(); }
      // Two doubles moved the token (4 then 6); the third must jail, not move.
      const moves = events.filter((e) => e.name === 'player:move');
      expect(moves).toHaveLength(2);
      expect(players[0].position).toBe(10);
    });

    it('resets the streak after a non-double', () => {
      const { tm } = build([[2, 2], [1, 3]]);
      tm.startTurn(); tm.rollDice();
      expect(players[0].doublesStreak).toBe(1);
      tm.startTurn(); tm.rollDice();
      expect(players[0].doublesStreak).toBe(0);
    });

    it('gives the same player another turn after a double', () => {
      const { tm } = build([[2, 2]]);
      tm.startTurn();
      tm.rollDice();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p1');
    });
  });

  describe('jail', () => {
    it('releases a jailed player who rolls doubles, without a bonus roll', () => {
      const { tm } = build([[5, 5]]);
      players[0].inJail = true;
      players[0].position = 10;

      tm.startTurn();
      tm.rollDice();

      expect(players[0].inJail).toBe(false);
      expect(players[0].position).toBe(20);
      expect(events.some((e) => e.name === 'jail:exit' && e.payload.method === 'doubles')).toBe(true);
      // isDoubles is deliberately passed as false so no extra turn is granted.
      expect(events.find((e) => e.name === 'player:move')!.payload.isDoubles).toBe(false);
    });

    it('holds the player for up to three failed attempts', () => {
      const { tm } = build([[1, 2], [1, 3], [2, 5]]);
      players[0].inJail = true;
      players[0].position = 10;

      tm.startTurn(); tm.rollDice();
      expect(players[0].inJail).toBe(true);
      expect(players[0].jailTurns).toBe(1);
      expect(events.some((e) => e.name === 'jail:stay')).toBe(true);

      tm.startTurn(); tm.rollDice();
      expect(players[0].jailTurns).toBe(2);
      expect(players[0].inJail).toBe(true);

      // Third failure — forced $50 fine, then the roll is played out.
      tm.startTurn(); tm.rollDice();
      expect(players[0].inJail).toBe(false);
      expect(players[0].cash).toBe(1450);
      expect(players[0].position).toBe(17);
      expect(events.some((e) => e.name === 'jail:exit' && e.payload.method === 'forced')).toBe(true);
    });

    it('never ends the turn synchronously while a jailed player waits', () => {
      // Ending the turn inside the roll handler re-registers the roll button
      // mid-event and leaves the next player unable to roll; TurnManager emits
      // jail:stay and lets the scene defer instead.
      const { tm } = build([[1, 2]]);
      players[0].inJail = true;
      tm.startTurn();
      tm.rollDice();

      expect(events.some((e) => e.name === 'jail:stay')).toBe(true);
      expect(events.some((e) => e.name === 'turn:end')).toBe(false);
      expect(tm.currentPlayer.id).toBe('p1');
    });

    it('releases a player who pays the $50 fine', () => {
      const { tm } = build([]);
      players[0].inJail = true;
      players[0].jailTurns = 2;

      tm.payJailFine(players[0]);

      expect(players[0].inJail).toBe(false);
      expect(players[0].jailTurns).toBe(0);
      expect(players[0].cash).toBe(1450);
      expect(tm.phase).toBe('WAITING_FOR_ROLL');
    });

    it('releases a player who spends a Get Out of Jail Free card', () => {
      const { tm } = build([]);
      players[0].inJail = true;
      players[0].getOutOfJailCards = 1;

      tm.useGetOutOfJailCard(players[0]);

      expect(players[0].inJail).toBe(false);
      expect(players[0].getOutOfJailCards).toBe(0);
      expect(players[0].cash).toBe(1500); // no fine paid
    });

    it('ignores a card release when the player holds none', () => {
      const { tm } = build([]);
      players[0].inJail = true;
      tm.useGetOutOfJailCard(players[0]);
      expect(players[0].inJail).toBe(true);
    });

    // GoToJailTile and the "Go to Jail" card emit jail:enter without going
    // through sendToJail(), so the listener applies the state — but must not
    // re-apply it when sendToJail() already did.
    it('applies jail state for an externally emitted jail:enter', () => {
      build([]);
      players[1].position = 30;

      bus.emit('jail:enter', { playerId: 'p2', reason: 'tile' });

      expect(players[1].inJail).toBe(true);
      expect(players[1].position).toBe(10);
      expect(players[1].jailTurns).toBe(0);
    });

    it('does not reset jailTurns when the player is already jailed', () => {
      build([]);
      players[1].inJail = true;
      players[1].jailTurns = 2;

      bus.emit('jail:enter', { playerId: 'p2', reason: 'doubles' });

      expect(players[1].jailTurns).toBe(2);
    });
  });

  describe('turn order', () => {
    it('advances to the next player after a plain turn', () => {
      const { tm } = build([[1, 2]]);
      tm.startTurn();
      tm.rollDice();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p2');
    });

    // The re-entry guard only covers calls made *while* endTurn is on the stack:
    // startTurn() clears the flag, so it cannot stop a later, stale call. That is
    // GameScene's turnGen counter's job, and the split is deliberate — see
    // KNOWNISSUES.md.
    it('blocks an endTurn re-entered from a turn:end listener', () => {
      const { tm } = build([[1, 2]]);
      tm.startTurn();
      tm.rollDice();

      let turnEnds = 0;
      bus.on('turn:end', () => {
        turnEnds++;
        if (turnEnds === 1) tm.endTurn(); // must be refused
      });

      tm.endTurn();

      expect(turnEnds).toBe(1);
      expect(tm.currentPlayer.id).toBe('p2'); // advanced exactly once
    });

    it('does not guard against a stale endTurn from a previous turn', () => {
      // Documents the actual behaviour the turnGen counter exists to compensate
      // for: once the next turn has started, a leftover call advances again.
      const { tm } = build([[1, 2]]);
      tm.startTurn();
      tm.rollDice();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p2');
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p3');
    });

    it('skips bankrupt players', () => {
      const { tm } = build([[1, 2]]);
      players[1].isBankrupt = true;
      tm.startTurn();
      tm.rollDice();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p3');
    });

    it('wraps around to the first player', () => {
      const { tm, dice } = build([]);
      dice.lastResult = { die1: 1, die2: 2, isDoubles: false, total: 3 };
      tm.startTurn();
      tm.endTurn(); // p1 → p2
      tm.endTurn(); // p2 → p3
      tm.endTurn(); // p3 → p1
      expect(tm.currentPlayer.id).toBe('p1');
    });

    it('ends the game when only one solvent player is left', () => {
      const { tm, dice } = build([]);
      dice.lastResult = { die1: 1, die2: 2, isDoubles: false, total: 3 };
      players[1].isBankrupt = true;
      players[2].isBankrupt = true;

      tm.startTurn();
      tm.endTurn();

      const end = events.find((e) => e.name === 'game:end');
      expect(end).toBeDefined();
      expect(end!.payload.winnerId).toBe('p1');
    });
  });

  describe('position sanitising', () => {
    it('resets a corrupted position instead of reading tiles[-1]', () => {
      const { tm } = build([[1, 2]]);
      players[0].position = -1;

      tm.startTurn();
      expect(() => tm.rollDice()).not.toThrow();
      expect(players[0].position).toBe(3); // reset to 0, then moved 3
    });

    it('recovers from a NaN position on landing', () => {
      const { tm } = build([]);
      players[0].position = NaN;
      expect(() => tm.resolveLanding()).not.toThrow();
      expect(players[0].position).toBe(0);
    });
  });

  describe('forcePlayerTurn (debug tool)', () => {
    it('hands the turn to the requested player', () => {
      const { tm } = build([]);
      tm.forcePlayerTurn(2);
      expect(tm.currentPlayer.id).toBe('p3');
    });

    it('refuses an out-of-range or bankrupt target', () => {
      const { tm } = build([]);
      players[1].isBankrupt = true;
      tm.forcePlayerTurn(1);
      expect(tm.currentPlayer.id).toBe('p1');
      tm.forcePlayerTurn(99);
      expect(tm.currentPlayer.id).toBe('p1');
      tm.forcePlayerTurn(-1);
      expect(tm.currentPlayer.id).toBe('p1');
    });
  });
});
