import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { TurnManager } from '@/game/TurnManager';
import { TurnFlow } from '@/game/TurnFlow';
import { resolveRules } from '@/game/Rules';
import {
  registerVariant, knownVariants, variantNamed, diceFor,
} from '@/game/Variants';
import { SpeedDice, SPEED_FACES, SPEED_BONUS_PHASE, type SpeedFace } from '@/game/SpeedDie';
import { Dice } from '@/game/Dice';
import { isOwnable } from '@/tiles/Tile';
import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';

describe('Variants', () => {
  it('ships the speed die, and refuses one nobody registered', () => {
    expect(knownVariants()).toContain('speedDie');
    expect(variantNamed('speedDie').label).toBe('Speed die');
    expect(() => variantNamed('teleportDie')).toThrow(/no variant called "teleportDie"/);
  });

  it('gives a rule set that names it the dice it plays with', () => {
    expect(diceFor(resolveRules())).toBeInstanceOf(Dice);
    expect(diceFor(resolveRules())).not.toBeInstanceOf(SpeedDice);
    expect(diceFor(resolveRules({ variants: ['speedDie'] }))).toBeInstanceOf(SpeedDice);
  });

  it('does not let one rule set leak its variants into another', () => {
    resolveRules({ variants: ['speedDie'] });
    expect(resolveRules().variants).toEqual([]);
  });

  it('lets a game register one, and applies it to the turn', () => {
    registerVariant('extraInnings', {
      label: 'Extra innings',
      apply: (flow) => flow.insertAfter('LANDING', { name: 'SEVENTH_INNING' }),
    });
    const flow = new TurnFlow(resolveRules({ variants: ['extraInnings'] }));
    expect(flow.names).toContain('SEVENTH_INNING');
  });
});

// ─── The speed die ────────────────────────────────────────────────────────────

describe('The speed die', () => {
  let board: Board;
  let players: Player[];
  let dice: SpeedDice;
  let events: Array<{ name: string; payload: Record<string, unknown> }>;

  const RULES = { variants: ['speedDie'] };

  const build = () => {
    bus.clear();
    board   = new Board(undefined, RULES);
    players = [new Player('p1', 'Ann', 'car'), new Player('p2', 'Bo', 'dog')];
    dice    = diceFor(board.rules) as SpeedDice;
    const tm = new TurnManager(players, board, dice);
    events = [];
    for (const name of ['player:move', 'turn:end', 'turn:phase']) {
      bus.on(name, (payload: Record<string, unknown>) => events.push({ name, payload }));
    }
    return tm;
  };

  const named = (name: string) => events.filter((e) => e.name === name);

  beforeEach(() => { bus.clear(); });

  it('adds a step to the turn, before the end of it', () => {
    const tm = build();
    expect(tm.flow.names).toEqual([
      'WAITING_FOR_ROLL', 'ROLLING', 'MOVING', 'LANDING',
      'AWAITING_BUY_DECISION', SPEED_BONUS_PHASE, 'END_TURN',
    ]);
  });

  it('adds only its number faces to the total, and leaves doubles alone', () => {
    rng.seed(20260512);
    const speed = new SpeedDice();
    const seen = new Set<SpeedFace | 'number'>();

    for (let i = 0; i < 300; i++) {
      const result = speed.roll();
      const bonus  = result.total - result.die1 - result.die2;

      if (speed.lastFace === null) {
        expect(bonus).toBeGreaterThanOrEqual(1);
        expect(bonus).toBeLessThanOrEqual(3);
        seen.add('number');
      } else {
        expect(bonus).toBe(0);          // a picture face moves you, it does not count
        seen.add(speed.lastFace);
      }
      // The third die is not part of a pair, so the jail rule is untouched.
      expect(result.isDoubles).toBe(result.die1 === result.die2);
    }
    expect(seen).toEqual(new Set(['number', 'bus', 'mrMonopoly']));
    expect(SPEED_FACES).toHaveLength(6);
  });

  it('sends Mr. Monopoly to the next deed that is not already yours', () => {
    const tm = build();
    tm.startTurn();
    players[0].position = 0;
    // Own the first deed forward, so it has to be skipped.
    const first = board.getTile(1);
    if (isOwnable(first)) first.ownerId = 'p1';
    players[0].ownedTileIds.add(1);

    dice.lastFace = 'mrMonopoly';
    tm.endTurn();

    const move = named('player:move')[0];
    expect(move).toBeDefined();
    expect(move.payload.from).toBe(0);
    expect(move.payload.to).not.toBe(1);
    const landed = board.getTile(move.payload.to as number);
    expect(isOwnable(landed)).toBe(true);
    expect(players[0].position).toBe(move.payload.to);
  });

  it('sends the bus to the next card tile', () => {
    const tm = build();
    tm.startTurn();
    players[0].position = 0;

    dice.lastFace = 'bus';
    tm.endTurn();

    const to = named('player:move')[0].payload.to as number;
    expect(['chance', 'communityChest']).toContain(board.getTile(to).type);
  });

  it('holds the turn for the walk, and gives it back when the landing resumes', () => {
    const tm = build();
    tm.startTurn();
    dice.lastFace = 'bus';
    tm.endTurn();

    expect(tm.isHeld).toBe(true);
    expect(named('turn:end')).toHaveLength(0);
    expect(tm.currentPlayer.id).toBe('p1');

    tm.resume();
    expect(named('turn:end')).toHaveLength(1);
    expect(tm.currentPlayer.id).toBe('p2');
  });

  // The walk the bonus move starts comes back through this phase when the
  // landing resumes the turn. An unconsumed face would move the player again,
  // and again, for ever.
  it('spends the face, so resuming does not move the player a second time', () => {
    const tm = build();
    tm.startTurn();
    dice.lastFace = 'mrMonopoly';
    tm.endTurn();

    expect(named('player:move')).toHaveLength(1);
    expect(dice.lastFace).toBeNull();
    tm.resolveLanding();          // what GameScene does when the tween finishes
    tm.resume();
    expect(named('player:move')).toHaveLength(1);
    expect(named('turn:end')).toHaveLength(1);
  });

  it('does nothing on a number face', () => {
    const tm = build();
    tm.startTurn();
    dice.lastFace = null;
    tm.endTurn();

    expect(named('player:move')).toHaveLength(0);
    expect(tm.isHeld).toBe(false);
    expect(named('turn:end')).toHaveLength(1);
  });

  it('does not move a jailed player', () => {
    const tm = build();
    tm.startTurn();
    players[0].inJail = true;
    dice.lastFace = 'bus';
    tm.endTurn();

    expect(named('player:move')).toHaveLength(0);
    expect(named('turn:end')).toHaveLength(1);
  });

  it('pays the salary when the bonus move passes the start', () => {
    const tm = build();
    tm.startTurn();
    const paid: Array<{ reason?: string; amount?: number }> = [];
    bus.on('rent:pay', (p: { reason?: string; amount?: number }) => paid.push(p));

    players[0].position = board.size - 1;   // one step short of GO
    dice.lastFace = 'bus';
    tm.endTurn();

    expect(paid.some((p) => p.reason === 'go' && p.amount === board.rules.goSalary)).toBe(true);
  });
});

// ─── The lap rule ─────────────────────────────────────────────────────────────
// "The speed die is not used until you have been round the board once."

describe('the speed die waits for a lap', () => {
  it('rolls two dice for a player who has not been round', () => {
    const dice = new SpeedDice();
    const fresh = { hasLapped: false };

    // Enough rolls that a picture face would certainly have shown by now: the
    // third die is six faces, three of which are pictures.
    for (let i = 0; i < 40; i++) {
      const result = dice.roll({ player: fresh });
      expect(dice.lastFace).toBeNull();
      expect(dice.lastNumber).toBeNull();
      // The total is the two white dice and nothing else.
      expect(result.total).toBe(result.die1 + result.die2);
    }
  });

  it('brings the third die in once the lap is done', () => {
    const dice = new SpeedDice();
    const lapped = { hasLapped: true };

    let sawSomething = false;
    for (let i = 0; i < 40; i++) {
      const result = dice.roll({ player: lapped });
      if (dice.lastFace !== null || result.total !== result.die1 + result.die2) {
        sawSomething = true;
      }
    }
    expect(sawSomething).toBe(true);
  });

  /** No context at all is the simulator and every test that predates the rule. */
  it('behaves as it always did when nobody says whose roll it is', () => {
    const dice = new SpeedDice();
    let sawSomething = false;
    for (let i = 0; i < 40; i++) {
      const result = dice.roll();
      if (dice.lastFace !== null || result.total !== result.die1 + result.die2) {
        sawSomething = true;
      }
    }
    expect(sawSomething).toBe(true);
  });
});
