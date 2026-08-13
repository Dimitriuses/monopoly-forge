import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { Dice, type DiceResult } from '@/game/Dice';
import { TurnManager } from '@/game/TurnManager';
import {
  TurnFlow, DEFAULT_PHASES,
  registerTurnOrder, registerWinCondition,
  knownTurnOrders, knownWinConditions,
  turnOrderNamed, winConditionNamed,
  type PhaseContext,
} from '@/game/TurnFlow';
import { resolveRules } from '@/game/Rules';
import { bus } from '@/utils/EventBus';

/** A Dice whose faces the test dictates — the PRNG has no place in these. */
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

describe('The turn pipeline', () => {
  let board: Board;
  let players: Player[];
  let events: Array<{ name: string; payload: Record<string, unknown> }>;

  /** bus.clear() has to run before the TurnManager is built — its constructor
   *  registers the jail:enter listener the game depends on. */
  const build = (script: Array<[number, number]>, flow?: TurnFlow) => {
    bus.clear();
    board = new Board();
    players = [
      new Player('p1', 'Ann', 'car'),
      new Player('p2', 'Bo', 'dog'),
      new Player('p3', 'Cy', 'iron'),
    ];
    const dice = new ScriptedDice(script);
    const tm = new TurnManager(players, board, dice, flow);

    events = [];
    for (const name of ['turn:start', 'turn:phase', 'turn:end', 'game:end']) {
      bus.on(name, (payload: Record<string, unknown>) => events.push({ name, payload }));
    }
    return { tm, dice };
  };

  const named = (name: string) => events.filter((e) => e.name === name);

  beforeEach(() => {
    bus.clear();
  });

  // ─── Phases ─────────────────────────────────────────────────────────────────

  describe('phases', () => {
    it('ships the classic six, in order', () => {
      const flow = new TurnFlow(resolveRules());
      expect(flow.names).toEqual([
        'WAITING_FOR_ROLL', 'ROLLING', 'MOVING', 'LANDING',
        'AWAITING_BUY_DECISION', 'END_TURN',
      ]);
    });

    it('announces every phase the turn enters', () => {
      const { tm } = build([[3, 4]]);
      tm.startTurn();
      tm.rollDice();
      tm.resolveLanding();

      expect(named('turn:phase').map((e) => e.payload.phase))
        .toEqual(['WAITING_FOR_ROLL', 'ROLLING', 'MOVING', 'LANDING']);
      // The first phase of a turn comes from nowhere; the rest say where from.
      expect(named('turn:phase')[0].payload.from).toBeNull();
      expect(named('turn:phase')[1].payload.from).toBe('WAITING_FOR_ROLL');
    });

    it('runs a phase a rule set added, before the turn ends', () => {
      const seen: Array<string | null> = [];
      const flow = new TurnFlow(resolveRules());
      flow.insertAfter('AWAITING_BUY_DECISION', {
        name: 'COLLECT_RENT_FROM_THE_TABLE',
        onEnter: (ctx: PhaseContext) => seen.push(ctx.from as string),
      });

      const { tm } = build([[3, 4]], flow);
      tm.startTurn();
      tm.rollDice();
      tm.resolveLanding();
      tm.endTurn();

      expect(seen).toEqual(['LANDING']);   // the phase the turn was actually in
      // ...and it ran before the turn was announced as over.
      const order = events.filter((e) => e.name === 'turn:phase' || e.name === 'turn:end');
      const custom = order.findIndex((e) => e.payload.phase === 'COLLECT_RENT_FROM_THE_TABLE');
      const ended  = order.findIndex((e) => e.name === 'turn:end');
      expect(custom).toBeGreaterThanOrEqual(0);
      expect(custom).toBeLessThan(ended);
    });

    it('lets a phase handler see the dice it was thrown for', () => {
      // ROLLING is entered after the throw on purpose: a variant that adds a die
      // or re-reads a face has somewhere to stand that is not inside rollDice.
      const flow = new TurnFlow(resolveRules());
      flow.replace('ROLLING', {
        onEnter: (ctx: PhaseContext) => {
          ctx.dice.lastResult = { ...ctx.dice.lastResult!, total: 11 };
        },
      });

      const { tm } = build([[3, 4]], flow);
      tm.startTurn();
      tm.rollDice();
      expect(players[0].position).toBe(11);   // not 7
    });

    it('never re-enters a phase something outside the model drives', () => {
      // endTurn() from a jailed player's turn must not walk back through ROLLING
      // and MOVING just because they sit later in the list.
      const { tm } = build([[3, 4]]);
      tm.startTurn();
      events.length = 0;
      tm.endTurn();

      // END_TURN, then the next player's WAITING_FOR_ROLL — and nothing between.
      expect(named('turn:phase').map((e) => e.payload.phase))
        .toEqual(['END_TURN', 'WAITING_FOR_ROLL']);
      expect(named('turn:phase').map((e) => e.payload.phase))
        .not.toContain('MOVING');
    });

    it('holds the turn where a phase asks it to, and carries on when resumed', () => {
      const flow = new TurnFlow(resolveRules());
      flow.insertAfter('AWAITING_BUY_DECISION', {
        name: 'WAIT_FOR_SOMETHING',
        onEnter: (ctx: PhaseContext) => ctx.hold(),
      });

      const { tm } = build([[3, 4]], flow);
      tm.startTurn();
      tm.endTurn();

      expect(tm.isHeld).toBe(true);
      expect(tm.phase).toBe('WAIT_FOR_SOMETHING');
      expect(named('turn:end')).toHaveLength(0);
      expect(tm.currentPlayer.id).toBe('p1');   // still nobody else's turn

      tm.resume();
      expect(tm.isHeld).toBe(false);
      expect(named('turn:end')).toHaveLength(1);
      expect(tm.currentPlayer.id).toBe('p2');
    });

    it('will not end a held turn twice', () => {
      const flow = new TurnFlow(resolveRules());
      flow.insertAfter('LANDING', { name: 'PAUSE', onEnter: (ctx) => ctx.hold() });

      const { tm } = build([[3, 4]], flow);
      tm.startTurn();
      tm.endTurn();
      tm.endTurn();              // blocked by the re-entry guard, which survives the hold
      tm.resume();

      expect(named('turn:end')).toHaveLength(1);
    });

    it('refuses to insert after a phase that does not exist, or to shadow one', () => {
      const flow = new TurnFlow(resolveRules());
      expect(() => flow.insertAfter('BREAKFAST', { name: 'X' }))
        .toThrow(/no phase called "BREAKFAST"/);
      expect(() => flow.insertAfter('LANDING', { name: 'END_TURN' }))
        .toThrow(/already in the turn/);
    });

    it('keeps a replaced phase in its place', () => {
      const flow = new TurnFlow(resolveRules());
      let ran = false;
      flow.replace('END_TURN', { onEnter: () => { ran = true; } });

      expect(flow.names.indexOf('END_TURN')).toBe(DEFAULT_PHASES.length - 1);
      const { tm } = build([[3, 4]], flow);
      tm.startTurn();
      tm.endTurn();
      expect(ran).toBe(true);
    });
  });

  // ─── Turn order ─────────────────────────────────────────────────────────────

  describe('turn order', () => {
    it('goes round the table by default', () => {
      const { tm } = build([[3, 4], [1, 2], [2, 5]]);
      tm.startTurn();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p2');
      tm.rollDice();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p3');
    });

    it('gives the same player another turn on doubles', () => {
      const { tm } = build([[4, 4]]);
      tm.startTurn();
      tm.rollDice();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p1');
      expect(named('turn:start')).toHaveLength(2);
    });

    it('does not, when the doubles roll bankrupted them', () => {
      // endTurn used to hand the extra turn out on the dice alone, so a player
      // who went under settling what they landed on rolled again from the grave.
      const { tm } = build([[4, 4]]);
      tm.startTurn();
      tm.rollDice();
      players[0].isBankrupt = true;
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p2');
    });

    it('skips a bankrupt seat', () => {
      const { tm } = build([[3, 4], [1, 2]]);
      tm.startTurn();
      players[1].isBankrupt = true;
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p3');
    });

    it('runs the table the other way when the rules say so', () => {
      const flow = new TurnFlow(resolveRules({ turnOrder: 'reverse' }));
      const { tm } = build([[3, 4], [1, 2]], flow);
      tm.startTurn();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p3');
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p2');
    });

    describe('with an order the game added', () => {
      afterEach(() => { /* the registry is global; the test names its own key */ });

      it('asks it who plays next', () => {
        // Two-a-side: play alternates between the teams rather than round the table.
        registerTurnOrder('pairs', ({ players, current }) => {
          const order = [0, 2, 1];
          const at = order.indexOf(current);
          return order[(at + 1) % order.length];
        });
        expect(knownTurnOrders()).toContain('pairs');

        const flow = new TurnFlow(resolveRules({ turnOrder: 'pairs' }));
        const { tm } = build([[3, 4], [1, 2]], flow);
        tm.startTurn();
        tm.endTurn();
        expect(tm.currentPlayer.id).toBe('p3');
        tm.endTurn();
        expect(tm.currentPlayer.id).toBe('p2');
      });

      it('ends the game when it says nobody can play', () => {
        registerTurnOrder('nobody', () => null);
        const flow = new TurnFlow(resolveRules({ turnOrder: 'nobody' }));
        const { tm } = build([[3, 4]], flow);
        tm.startTurn();
        tm.endTurn();
        expect(named('game:end')).toHaveLength(1);
      });
    });

    it('refuses an order nobody registered, and says what it knows', () => {
      expect(() => turnOrderNamed('anticlockwise'))
        .toThrow(/no turn order called "anticlockwise"/);
      expect(() => new TurnFlow(resolveRules({ turnOrder: 'anticlockwise' })))
        .toThrow(/seat/);   // the message lists what it does know
    });
  });

  // ─── Rounds ─────────────────────────────────────────────────────────────────

  describe('rounds', () => {
    it('counts one per pass round the table', () => {
      const { tm } = build([[3, 4], [1, 2], [2, 5], [3, 2]]);
      tm.startTurn();
      expect(tm.round).toBe(1);
      tm.endTurn();  // p2
      tm.endTurn();  // p3
      expect(tm.round).toBe(1);
      tm.endTurn();  // back to p1 — everyone has played
      expect(tm.round).toBe(2);
      expect(tm.currentPlayer.id).toBe('p1');
    });

    it('does not count a doubles re-roll as a new round', () => {
      const { tm } = build([[4, 4], [4, 4]]);
      tm.startTurn();
      tm.rollDice();
      tm.endTurn();
      expect(tm.currentPlayer.id).toBe('p1');
      expect(tm.round).toBe(1);
    });

    it('counts the same when a seat drops out mid-round', () => {
      const { tm } = build([[3, 4], [1, 2], [2, 5]]);
      tm.startTurn();          // p1, round 1
      players[1].isBankrupt = true;
      tm.endTurn();            // skips p2 → p3
      expect(tm.round).toBe(1);
      tm.endTurn();            // → p1, who has already played
      expect(tm.round).toBe(2);
    });
  });

  // ─── Win condition ──────────────────────────────────────────────────────────

  describe('the win condition', () => {
    it('is the last solvent player by default', () => {
      const { tm } = build([[3, 4]]);
      tm.startTurn();
      players[1].isBankrupt = true;
      players[2].isBankrupt = true;
      tm.endTurn();

      expect(named('game:end')).toHaveLength(1);
      expect(named('game:end')[0].payload.winnerId).toBe('p1');
    });

    it('is asked before the extra turn doubles would have earned', () => {
      // Otherwise a player who bankrupts the last opponent on doubles keeps
      // rolling against an empty table until they fail to roll a pair.
      const { tm } = build([[4, 4]]);
      tm.startTurn();
      tm.rollDice();
      players[1].isBankrupt = true;
      players[2].isBankrupt = true;
      tm.endTurn();

      expect(named('game:end')).toHaveLength(1);
      expect(named('turn:start')).toHaveLength(1);
    });

    it('can be a round limit, won by the largest estate', () => {
      const flow = new TurnFlow(resolveRules({ winCondition: 'roundLimit', roundLimit: 1 }));
      const { tm } = build([[3, 4], [1, 2], [2, 5]], flow);
      players[1].cash = 9999;

      tm.startTurn();
      tm.endTurn();   // → p2, round 1
      tm.endTurn();   // → p3, round 1
      expect(named('game:end')).toHaveLength(0);
      tm.endTurn();   // round 2 — past the limit

      expect(named('game:end')).toHaveLength(1);
      expect(named('game:end')[0].payload.winnerId).toBe('p2');
    });

    it('treats a round limit of zero as no limit at all', () => {
      const flow = new TurnFlow(resolveRules({ winCondition: 'roundLimit' }));
      const { tm } = build([[3, 4], [1, 2], [2, 5], [3, 3]], flow);
      tm.startTurn();
      for (let i = 0; i < 6; i++) tm.endTurn();
      expect(named('game:end')).toHaveLength(0);
    });

    it('takes one a game registers', () => {
      registerWinCondition('firstToBroke', ({ players }) => {
        const broke = players.find((p) => p.cash <= 0);
        return broke ? { winnerId: broke.id } : null;
      });
      expect(knownWinConditions()).toContain('firstToBroke');

      const flow = new TurnFlow(resolveRules({ winCondition: 'firstToBroke' }));
      const { tm } = build([[3, 4], [1, 2]], flow);
      tm.startTurn();
      tm.endTurn();
      expect(named('game:end')).toHaveLength(0);

      players[2].cash = 0;
      tm.endTurn();
      expect(named('game:end')[0].payload.winnerId).toBe('p3');
    });

    it('refuses one nobody registered', () => {
      expect(() => winConditionNamed('mostRailroads'))
        .toThrow(/no win condition called "mostRailroads"/);
    });
  });
});
