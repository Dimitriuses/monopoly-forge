import { dwarn } from '@/utils/log';
import { liquidValue } from './Estate';
import { applyVariants } from './Variants';
import { Registry } from '@/utils/Registry';
// Side-effect import: the variants that ship register themselves, the same way
// the built-in tile types do. It has to be a module everything that builds a
// turn already reaches, and `SpeedDie` imports nothing from here but types, so
// there is no cycle at runtime.
import './SpeedDie';
import type { Board } from './Board';
import type { Dice } from './Dice';
import type { Player } from './Player';
import type { GameRules } from './Rules';

// ─── TurnFlow ─────────────────────────────────────────────────────────────────
// What a turn is made of, and who decides how the game moves on — the last three
// things `TurnManager` used to know all by itself.
//
// Until now the turn was a fixed enum walked by hand, the next player was
// "current + 1, skipping the bankrupt", and the game was over when one solvent
// player was left. All three were written into the class, so a variant could not
// change any of them without editing the engine. They are three separate seams
// and they are opened three different ways:
//
//   * **Phases are a list.** Named, ordered, extendable — `insertAfter` puts a
//     step into a turn. `TurnManager` enters them by name instead of assigning a
//     string literal, and everything watching the game sees `turn:phase`.
//   * **Turn order is a registered function.** Given the table and whose turn it
//     was, it names the next seat — or `null` when nobody can play.
//   * **The win condition is a registered function.** Asked once per turn change;
//     a non-null answer ends the game.
//
// The last two are registries by name (`rules.turnOrder`, `rules.winCondition`)
// rather than function fields on `GameRules`, for the same reason tile types and
// card effects are: a rule set is saved with the game, and a function does not
// survive `JSON.stringify`.
//
// Nothing here may import a scene (invariant 2) — a phase handler runs in the
// simulator too, where there is no renderer to talk to.

// ─── Phases ───────────────────────────────────────────────────────────────────

export type BuiltInPhase =
  | 'WAITING_FOR_ROLL'
  | 'ROLLING'
  | 'MOVING'
  | 'LANDING'
  | 'AWAITING_BUY_DECISION'
  | 'END_TURN';

/** Named, but not closed: a rule set may add a phase of its own. */
export type TurnPhase = BuiltInPhase | (string & {});

export interface PhaseContext {
  player: Player;
  players: Player[];
  board: Board;
  dice: Dice;
  /** Which phase the turn came from — `null` at the start of a turn. */
  from: TurnPhase | null;
  /**
   * Stop here rather than carrying on to the end of the turn. The turn resumes
   * when something calls `TurnManager.resume()` — which is how a phase that has
   * to wait for a person (or an animation) is written without a scene.
   */
  hold(): void;
}

export interface PhaseSpec {
  name: TurnPhase;
  /**
   * Runs on entry. Model-only: no scene, no tween, no button.
   *
   * A phase runs on the way to `END_TURN` *wherever the turn happened to be*,
   * including a turn that ended without a move (a jailed player who stayed put).
   * A handler that only makes sense after a landing has to check for itself.
   */
  onEnter?(ctx: PhaseContext): void;
  /**
   * True for phases something *outside* the model drives: the roll button, the
   * move tween, the buy prompt. The pipeline never enters these on its own —
   * `TurnManager` and `GameScene` do, when the thing they were waiting for
   * happens. A phase a rule set adds is not driven by default, so the walk to
   * the end of the turn runs it.
   */
  driven?: boolean;
}

/** The classic turn: roll, move, land, decide, end. */
export const DEFAULT_PHASES: readonly PhaseSpec[] = [
  { name: 'WAITING_FOR_ROLL',      driven: true },
  { name: 'ROLLING',               driven: true },
  { name: 'MOVING',                driven: true },
  { name: 'LANDING',               driven: true },
  { name: 'AWAITING_BUY_DECISION', driven: true },
  { name: 'END_TURN' },
];

// ─── Turn order ───────────────────────────────────────────────────────────────

export interface OrderContext {
  players: Player[];
  /** The seat that has just finished. */
  current: number;
  board: Board;
  dice: Dice;
  /** The round about to start, counted from 1. */
  round: number;
  /** The rule set the flow was built from — read it here, not off the board. */
  rules: GameRules;
}

/** The seat that plays next, or `null` when nobody can. */
export type TurnOrderFn = (ctx: OrderContext) => number | null;

export type BuiltInTurnOrder = 'seat' | 'reverse';

export const TURN_ORDERS = new Registry<TurnOrderFn>('turn orders');

export function registerTurnOrder(name: string, fn: TurnOrderFn): void {
  TURN_ORDERS.set(name, fn);
}

export function knownTurnOrders(): string[] {
  return TURN_ORDERS.names();
}

/** Unknown means the game cannot proceed, so this throws rather than guessing. */
export function turnOrderNamed(name: string): TurnOrderFn {
  const fn = TURN_ORDERS.get(name);
  if (!fn) {
    throw new Error(
      `[TurnFlow] no turn order called "${name}" — known: ${knownTurnOrders().join(', ')}`,
    );
  }
  return fn;
}

/** Step `by` seats from `current`, skipping the bankrupt. `null` if all are out. */
function step(players: Player[], current: number, by: number): number | null {
  const n = players.length;
  let i = current;
  for (let taken = 0; taken < n; taken++) {
    i = ((i + by) % n + n) % n;
    if (!players[i].isBankrupt) return i;
  }
  return null;
}

/**
 * Around the table, and the same player again on doubles — the classic rule, and
 * the only place that rule now lives. A player already in jail does not get the
 * extra turn (three doubles put them there), and neither does one who went
 * bankrupt settling what they landed on, which `endTurn` used to overlook.
 */
registerTurnOrder('seat', ({ players, current, dice }) => {
  const player = players[current];
  if (dice.lastResult?.isDoubles && !player.inJail && !player.isBankrupt) return current;
  return step(players, current, 1);
});

/** The same rule the other way round — the cheapest proof the seam is real. */
registerTurnOrder('reverse', ({ players, current, dice }) => {
  const player = players[current];
  if (dice.lastResult?.isDoubles && !player.inJail && !player.isBankrupt) return current;
  return step(players, current, -1);
});

// ─── Win condition ────────────────────────────────────────────────────────────

export interface OutcomeContext {
  players: Player[];
  board: Board;
  /** The round about to start, counted from 1. */
  round: number;
  rules: GameRules;
}

/** Non-null ends the game. `winnerId` may be null: everybody can lose at once. */
export type WinConditionFn = (ctx: OutcomeContext) => { winnerId: string | null } | null;

export type BuiltInWinCondition = 'lastSolvent' | 'roundLimit';

export const WIN_CONDITIONS = new Registry<WinConditionFn>('win conditions');

export function registerWinCondition(name: string, fn: WinConditionFn): void {
  WIN_CONDITIONS.set(name, fn);
}

export function knownWinConditions(): string[] {
  return WIN_CONDITIONS.names();
}

export function winConditionNamed(name: string): WinConditionFn {
  const fn = WIN_CONDITIONS.get(name);
  if (!fn) {
    throw new Error(
      `[TurnFlow] no win condition called "${name}" — known: ${knownWinConditions().join(', ')}`,
    );
  }
  return fn;
}

function solvent(players: Player[]): Player[] {
  return players.filter((p) => !p.isBankrupt);
}

/** The classic: play until one player is left standing. */
registerWinCondition('lastSolvent', ({ players }) => {
  const left = solvent(players);
  return left.length <= 1 ? { winnerId: left[0]?.id ?? null } : null;
});

/**
 * A fixed number of rounds, then the richest estate wins — the variant people
 * actually play when they do not have three hours. Wealth is `liquidValue`:
 * cash plus what the player could raise, which is the only measure the engine
 * already agrees on (it is what a fire sale draws from). A tie goes to the
 * earlier seat, so the result is reproducible.
 *
 * `rules.roundLimit` of 0 means no limit, and this behaves as `lastSolvent`.
 */
registerWinCondition('roundLimit', ({ players, board, round, rules }) => {
  const left = solvent(players);
  if (left.length <= 1) return { winnerId: left[0]?.id ?? null };

  const limit = rules.roundLimit;
  if (!limit || round <= limit) return null;

  const richest = left.reduce((best, p) => (
    liquidValue(board, p) > liquidValue(board, best) ? p : best
  ));
  return { winnerId: richest.id };
});

// ─── The flow itself ──────────────────────────────────────────────────────────

export class TurnFlow {
  readonly phases: PhaseSpec[];
  readonly nextSeat: TurnOrderFn;
  readonly outcome: WinConditionFn;
  /** The rule set the strategies are handed. Kept here rather than read off the
   *  board so a flow built from one rule set cannot be driven by another. */
  readonly rules: GameRules;

  constructor(rules: GameRules, phases: readonly PhaseSpec[] = DEFAULT_PHASES) {
    this.phases   = phases.map((p) => ({ ...p }));
    this.rules    = rules;
    this.nextSeat = turnOrderNamed(rules.turnOrder);
    this.outcome  = winConditionNamed(rules.winCondition);
    // Last, so a variant reshapes a turn that is otherwise fully built.
    applyVariants(rules, this);
  }

  get names(): TurnPhase[] {
    return this.phases.map((p) => p.name);
  }

  has(name: TurnPhase): boolean {
    return this.phases.some((p) => p.name === name);
  }

  get(name: TurnPhase): PhaseSpec | undefined {
    return this.phases.find((p) => p.name === name);
  }

  /**
   * The phases the turn still has to pass through, in order. `driven` ones are
   * left out: whatever drives them has already had its chance by the time a turn
   * is ending, and re-entering `MOVING` from `endTurn` would be nonsense.
   */
  remaining(after: TurnPhase): PhaseSpec[] {
    const at = this.phases.findIndex((p) => p.name === after);
    // An unknown phase is treated as "before everything" rather than refused —
    // a rule set may have swapped the list under a turn that was already running.
    return this.phases.slice(at + 1).filter((p) => !p.driven);
  }

  /** Put a phase into the turn, straight after an existing one. */
  insertAfter(existing: TurnPhase, spec: PhaseSpec): void {
    const at = this.phases.findIndex((p) => p.name === existing);
    if (at < 0) throw new Error(`[TurnFlow] there is no phase called "${existing}"`);
    if (this.has(spec.name)) throw new Error(`[TurnFlow] "${spec.name}" is already in the turn`);
    this.phases.splice(at + 1, 0, { ...spec });
  }

  /** Swap a phase's behaviour, keeping its place in the order. */
  replace(name: TurnPhase, spec: Omit<PhaseSpec, 'name'>): void {
    const at = this.phases.findIndex((p) => p.name === name);
    if (at < 0) throw new Error(`[TurnFlow] there is no phase called "${name}"`);
    this.phases[at] = { ...this.phases[at], ...spec, name };
  }

  /** Take a phase out. The built-in six are refused: something drives each of them. */
  remove(name: TurnPhase): void {
    const at = this.phases.findIndex((p) => p.name === name);
    if (at < 0) return;
    if (DEFAULT_PHASES.some((p) => p.name === name)) {
      dwarn(`[TurnFlow] refusing to remove the built-in phase "${name}"`);
      return;
    }
    this.phases.splice(at, 1);
  }
}
