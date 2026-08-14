import { knownTurnOrders, knownWinConditions } from './TurnFlow';
import { knownVariants, variantNamed } from './Variants';
import type { GameRules } from './Rules';

// ─── RuleFields ───────────────────────────────────────────────────────────────
// What a player may change, and how to show it.
//
// `GameRules` has been a flat bag of numbers and switches since 8b, which is
// exactly the shape a settings screen wants — but it says nothing about *how* to
// present one. What is a sensible range for the jail fine? Is `roundLimit: 0` a
// zero or an "off"? Which of these should a person be allowed near at all?
//
// So the metadata lives here, next to the rules and still in plain Node, and the
// screen is **generated** from it. A rule added to `GameRules` gets a row by
// adding one line here rather than by editing a scene, and the three
// hand-positioned house-rule chips the menu used to draw are gone.
//
// Two things are deliberately *not* editable:
//
//   * **`movement`.** Setting a tracks board to `circuit` would make it a
//     120-tile single loop, and `validateGame` refuses that pairing outright —
//     so the menu would be offering a choice that silently drops you back to the
//     classic game. It is a property of the board, not a preference.
//   * **`variants`, `bidSteps`.** Lists, not scalars. `variants` gets rows of its
//     own below, because each one really is a switch; `bidSteps` has no control
//     worth building until somebody wants it.

export type RuleFieldKind = 'number' | 'money' | 'boolean' | 'choice';

/**
 * Which section of the settings screen a rule belongs to. Twenty rows do not fit
 * on one screen, and a menu that scrolls is a menu whose rows a harness has to
 * scroll into view — sections are both the smaller change and the better read.
 */
export type RuleGroup = 'money' | 'jail' | 'building' | 'rent' | 'auction' | 'ending' | 'house';

export const RULE_GROUPS: ReadonlyArray<{ id: RuleGroup; label: string }> = [
  { id: 'money',    label: 'Money' },
  { id: 'jail',     label: 'Jail' },
  { id: 'building', label: 'Building' },
  { id: 'rent',     label: 'Rent' },
  { id: 'auction',  label: 'Auctions' },
  { id: 'ending',   label: 'Turns and endings' },
  { id: 'house',    label: 'House rules' },
];

export interface RuleField {
  key: keyof GameRules;
  group: RuleGroup;
  label: string;
  kind: RuleFieldKind;
  /** Smallest and largest a person may set it to, and the step of one nudge. */
  min?: number;
  max?: number;
  step?: number;
  /** What to show instead of `0` — "off" reads better than "0 rounds". */
  zeroLabel?: string;
  /** For `choice`: the registered names, asked at render time. */
  options?: () => string[];
  /** One line under the row, when the label alone is not enough. */
  hint?: string;
}

export const RULE_FIELDS: readonly RuleField[] = [
  { key: 'startingCash', group: 'money', label: 'Starting cash', kind: 'money', min: 0, max: 10000, step: 100 },
  { key: 'goSalary', group: 'money', label: 'Salary for passing GO', kind: 'money', min: 0, max: 1000, step: 50 },

  { key: 'jailFine', group: 'jail', label: 'Jail fine', kind: 'money', min: 0, max: 500, step: 10 },
  {
    key: 'jailTerm', group: 'jail', label: 'Turns in jail', kind: 'number', min: 1, max: 10,
    hint: 'Turns before the fine is forced',
  },
  { key: 'doublesToJail', group: 'jail', label: 'Doubles that send you to jail', kind: 'number', min: 2, max: 6 },

  { key: 'houseLimit', group: 'building', label: 'Houses in the bank', kind: 'number', min: 4, max: 120, step: 4 },
  { key: 'hotelLimit', group: 'building', label: 'Hotels in the bank', kind: 'number', min: 1, max: 40 },
  {
    key: 'housesBeforeHotel', group: 'building', label: 'Houses before a hotel', kind: 'number', min: 1, max: 8,
  },
  {
    key: 'houseAuctions', group: 'building', label: 'Auction the last houses', kind: 'boolean',
    hint: 'When more players want one than the bank has left',
  },

  {
    key: 'monopolyRent', group: 'rent', label: 'Rent for a full colour group', kind: 'number', min: 1, max: 5,
    hint: 'Multiplier on an unimproved lot',
  },
  {
    key: 'majorityRent', group: 'rent', label: 'Rent for all but one', kind: 'number', min: 1, max: 5,
    hint: 'Groups of three or more. 1 turns it off',
  },

  { key: 'auctionSeconds', group: 'auction', label: 'Seconds to bid', kind: 'number', min: 5, max: 60, step: 5 },
  { key: 'bidIncrement', group: 'auction', label: 'Smallest raise', kind: 'money', min: 1, max: 100, step: 5 },

  { key: 'turnOrder', group: 'ending', label: 'Turn order', kind: 'choice', options: knownTurnOrders },
  { key: 'winCondition', group: 'ending', label: 'The game ends when', kind: 'choice', options: knownWinConditions },
  {
    key: 'roundLimit', group: 'ending', label: 'Round limit', kind: 'number', min: 0, max: 300, step: 10,
    zeroLabel: 'off', hint: 'Only used by the "roundLimit" ending',
  },

  {
    key: 'botOffersTrades', group: 'house', label: 'Bots may offer you trades', kind: 'boolean',
    hint: 'Uninvited, on their own turn',
  },
  {
    key: 'botTradeCooldown', group: 'house', label: 'Rounds between their offers',
    kind: 'number', min: 0, max: 20, zeroLabel: 'no wait',
  },
  { key: 'freeParkingJackpot', group: 'house', label: 'Free Parking jackpot', kind: 'boolean' },
  { key: 'doubleGoSalary', group: 'house', label: 'Double salary landing on GO', kind: 'boolean' },
  { key: 'noAuction', group: 'house', label: 'No auctions', kind: 'boolean' },
];

/** How a field's current value reads on the row. */
export function formatRuleValue(field: RuleField, value: unknown): string {
  if (field.kind === 'boolean') return value ? 'on' : 'off';
  if (field.zeroLabel && value === 0) return field.zeroLabel;
  if (field.kind === 'money') return `$${Number(value).toLocaleString('en-US')}`;
  return String(value);
}

/** The value one nudge away, clamped, wrapping for a choice. */
export function nudgeRuleValue(field: RuleField, value: unknown, delta: 1 | -1): unknown {
  if (field.kind === 'boolean') return !value;

  if (field.kind === 'choice') {
    const options = field.options?.() ?? [];
    if (!options.length) return value;
    const at = options.indexOf(String(value));
    return options[((at < 0 ? 0 : at) + delta + options.length) % options.length];
  }

  const step = field.step ?? 1;
  const next = Number(value) + delta * step;
  return Math.max(field.min ?? 0, Math.min(field.max ?? Number.MAX_SAFE_INTEGER, next));
}

// ─── Variants ─────────────────────────────────────────────────────────────────

export interface VariantField {
  name: string;
  label: string;
  blurb?: string;
}

/**
 * Every registered variant, as a switch. A list rather than a scalar, so it
 * cannot be a `RuleField` — but each *entry* is a plain on/off, which is why the
 * settings screen can show them in the same column as the booleans above.
 */
export function variantFields(): VariantField[] {
  return knownVariants().map((name) => {
    const variant = variantNamed(name);
    return { name, label: variant.label, blurb: variant.blurb };
  });
}
