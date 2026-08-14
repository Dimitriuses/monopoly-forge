import { Registry } from '@/utils/Registry';
import type { Board } from './Board';
import type { Dice, DiceResult } from './Dice';
import type { Player } from './Player';
import type { GameRules } from './Rules';

// ─── RollRules ────────────────────────────────────────────────────────────────
// What a roll *means*, before anybody moves.
//
// `TurnManager.rollDice` held it as an `if`: doubles increment a streak, three
// of them go to jail, anything else moves. Correct for the printed game and
// closed to every other one — a rule set could change `doublesToJail` to four
// but could not say that a **triple** meant anything at all, which is why the
// speed die's own "roll a triple and move anywhere" has been deferred since 8b.
//
// So the interpretation is a named strategy, the fifth of them, and named by
// string in the rule set for the same reason `turnOrder` and `winCondition` are:
// a rule set is saved with the game and a function does not survive
// `JSON.stringify`.
//
// The division that makes this work: a rule returns **what should happen**, and
// `TurnManager` does it. A rule that moved the player itself would be a second
// mover, and the phase pipeline would have two things deciding when a turn ends.
// `handled` is the one exception, and it is for a rule that has started
// something asynchronous — a prompt — and will finish the turn when it resolves.

export interface RollContext {
  dice: Dice;
  result: DiceResult;
  player: Player;
  board: Board;
  rules: GameRules;
  /** Ask a question and finish the turn when it is answered. See `game/Choice.ts`. */
  choose(prompt: string, options: Array<{ id: string; label: string; tileId?: number;
    weight?: number }>, then: (optionId: string) => void): boolean;
}

export type RollOutcome =
  /** Move this many, and roll again afterwards if `again`. */
  | { kind: 'move'; steps: number; again: boolean }
  /** Straight to jail; no move, no re-roll. */
  | { kind: 'jail' }
  /** The rule is dealing with it — usually a prompt in flight. */
  | { kind: 'handled' };

export interface RollRule {
  (ctx: RollContext): RollOutcome;
}

export type BuiltInRollRule = 'classic';

export const ROLL_RULES = new Registry<RollRule>('roll rules');

export function registerRollRule(name: string, rule: RollRule): void {
  ROLL_RULES.set(name, rule);
}

export function knownRollRules(): string[] {
  return ROLL_RULES.names();
}

export function rollRuleNamed(name: string): RollRule {
  return ROLL_RULES.require(name);
}

/**
 * The printed rule, and the behaviour every board had before this file: doubles
 * roll again, and the third pair in a row goes to jail. `doublesToJail` has been
 * a rule-set value since 8b and stays one.
 */
registerRollRule('classic', ({ result, player, rules }) => {
  if (!result.isDoubles) {
    player.doublesStreak = 0;
    return { kind: 'move', steps: result.total, again: false };
  }

  player.doublesStreak++;
  if (player.doublesStreak >= rules.doublesToJail) {
    player.doublesStreak = 0;
    return { kind: 'jail' };
  }
  return { kind: 'move', steps: result.total, again: true };
});
