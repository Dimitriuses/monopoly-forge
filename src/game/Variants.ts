import { Dice } from './Dice';
import { Registry } from '@/utils/Registry';
import type { GameRules } from './Rules';
import type { TurnFlow } from './TurnFlow';

// ─── Variants ─────────────────────────────────────────────────────────────────
// A rule that is not a number and not a strategy, but a *bundle*: different dice,
// an extra step in the turn, or both. The speed die is the case that forced it —
// M6 tried to ship it as a boolean called `speedDie`, and it is nothing of the
// kind. A third die changes what a roll is, and its two picture faces add a step
// after the landing.
//
// So a variant is what a rule set names when it wants both at once. It is a
// registry for the same reason tile types and card effects are: a rule set is
// saved with the game, and `['speedDie']` survives `JSON.stringify` where a pair
// of functions does not.
//
// Nothing here may import a scene. A variant changes the game, not the picture.

export interface Variant {
  /** What the menu calls it. */
  label: string;
  /** One line saying what it does, for the menu's tooltip row. */
  blurb?: string;
  /** Change the shape of a turn: insert a phase, replace a handler. */
  apply?(flow: TurnFlow): void;
  /** Supply the dice the variant is played with. */
  dice?(rules: GameRules): Dice;
}

export const VARIANTS = new Registry<Variant>('variants');

export function registerVariant(name: string, variant: Variant): void {
  VARIANTS.set(name, variant);
}

export function knownVariants(): string[] {
  return VARIANTS.names();
}

/** Unknown means a game nobody can play, so this throws rather than guessing. */
export function variantNamed(name: string): Variant {
  const variant = VARIANTS.get(name);
  if (!variant) {
    throw new Error(
      `[Variants] no variant called "${name}" — known: ${knownVariants().join(', ') || 'none'}`,
    );
  }
  return variant;
}

/** Every variant a rule set switched on, in the order it named them. */
export function variantsOf(rules: GameRules): Variant[] {
  return (rules.variants ?? []).map(variantNamed);
}

/**
 * The dice this rule set is played with. The *last* variant to offer a set wins,
 * because two variants each replacing the dice cannot both be honoured and
 * silently rolling one of them would be worse than picking the later one.
 */
export function diceFor(rules: GameRules): Dice {
  let dice = new Dice();
  for (const variant of variantsOf(rules)) {
    if (variant.dice) dice = variant.dice(rules);
  }
  return dice;
}

/** Let every variant reshape the turn. Called by `TurnFlow`'s constructor. */
export function applyVariants(rules: GameRules, flow: TurnFlow): void {
  for (const variant of variantsOf(rules)) variant.apply?.(flow);
}
