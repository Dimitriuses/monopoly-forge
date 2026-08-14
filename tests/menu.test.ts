import { describe, it, expect, beforeEach } from 'vitest';
import {
  RULE_FIELDS, RULE_GROUPS, formatRuleValue, nudgeRuleValue, variantFields,
} from '@/game/RuleFields';
import { CLASSIC_RULES, resolveRules, type GameRules } from '@/game/Rules';
import { rulesFor, GAMES } from '@/games';
import { SaveLoad, SAVE_SLOTS } from '@/utils/SaveLoad';

// ─── The menu's model half ────────────────────────────────────────────────────
// The screens are Phaser and are checked by the playtest; what is checked here is
// everything the menu *decides* — which rules it may show, what one nudge does,
// and that the overrides it collects layer the way the engine layers them.

describe('rule fields — the settings screen is generated from these', () => {
  it('names only real rules, each in a section that exists', () => {
    const groups = new Set(RULE_GROUPS.map((g) => g.id));
    for (const field of RULE_FIELDS) {
      expect(CLASSIC_RULES, `unknown rule "${String(field.key)}"`)
        .toHaveProperty(field.key as string);
      expect(groups.has(field.group), `${String(field.key)} is in no section`).toBe(true);
    }
  });

  it('describes each rule once', () => {
    const keys = RULE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * `movement` is a property of the *board*, not a preference: setting a tracks
   * board to `circuit` makes it one 120-tile loop, which `validateGame` refuses —
   * so offering it would be offering a choice that drops you back to Classic.
   */
  it('leaves out the rules a player must not set', () => {
    const shown = RULE_FIELDS.map((f) => f.key);
    for (const key of ['movement', 'variants', 'bidSteps']) {
      expect(shown, `${key} must not be player-editable`).not.toContain(key);
    }
  });

  it('formats a value the way the row reads it', () => {
    const money = RULE_FIELDS.find((f) => f.key === 'startingCash')!;
    expect(formatRuleValue(money, 1500)).toBe('$1,500');

    const limit = RULE_FIELDS.find((f) => f.key === 'roundLimit')!;
    expect(formatRuleValue(limit, 0)).toBe('off');
    expect(formatRuleValue(limit, 40)).toBe('40');

    const flag = RULE_FIELDS.find((f) => f.key === 'noAuction')!;
    expect(formatRuleValue(flag, true)).toBe('on');
    expect(formatRuleValue(flag, false)).toBe('off');
  });

  it('clamps a nudge at both ends rather than running off', () => {
    const term = RULE_FIELDS.find((f) => f.key === 'jailTerm')!;
    expect(nudgeRuleValue(term, term.min, -1)).toBe(term.min);
    expect(nudgeRuleValue(term, term.max, 1)).toBe(term.max);
    expect(nudgeRuleValue(term, 3, 1)).toBe(4);
  });

  it('steps money by its step, not by one', () => {
    const cash = RULE_FIELDS.find((f) => f.key === 'startingCash')!;
    expect(nudgeRuleValue(cash, 1500, 1)).toBe(1600);
  });

  it('wraps a choice round its registered options', () => {
    const order = RULE_FIELDS.find((f) => f.key === 'turnOrder')!;
    const options = order.options!();
    expect(options.length).toBeGreaterThan(1);

    const last = options[options.length - 1];
    expect(nudgeRuleValue(order, last, 1)).toBe(options[0]);
    expect(nudgeRuleValue(order, options[0], -1)).toBe(last);
  });

  it('offers every registered variant as a switch', () => {
    expect(variantFields().map((v) => v.name)).toContain('speedDie');
    for (const variant of variantFields()) expect(variant.label).toBeTruthy();
  });
});

describe('overrides — only what the player changed', () => {
  /**
   * The whole point of keeping overrides rather than a full rule set. A game's
   * default has to win on a rule nobody touched, *and* a touched rule has to
   * survive changing game — which is the pair the three `xChosen` flags used to
   * juggle, and the half Pocket lost in M9b.
   */
  it('lets a game move an untouched rule and keeps a touched one', () => {
    const overrides: Partial<GameRules> = { jailFine: 75 };

    const classic = rulesFor(GAMES.classic, overrides);
    const pocket  = rulesFor(GAMES.pocket, overrides);

    // Touched: the same on both, whatever the game says.
    expect(classic.jailFine).toBe(75);
    expect(pocket.jailFine).toBe(75);

    // Untouched: Pocket asks for the Free Parking jackpot and gets it.
    expect(classic.freeParkingJackpot).toBe(false);
    expect(pocket.freeParkingJackpot).toBe(true);
  });

  it('an empty override set is exactly the game’s own rules', () => {
    for (const game of Object.values(GAMES)) {
      expect(rulesFor(game, {})).toEqual(rulesFor(game));
    }
  });

  it('layers the same way the engine does', () => {
    const overrides = { startingCash: 999 };
    expect(rulesFor(GAMES.classic, overrides).startingCash)
      .toBe(resolveRules(GAMES.classic.rules, overrides).startingCash);
  });
});

// ─── Save slots ───────────────────────────────────────────────────────────────

/** Node has no localStorage, and SaveLoad only touches it when called. */
function stubStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

describe('save slots', () => {
  beforeEach(stubStorage);

  it('reports every slot, used or not', () => {
    const slots = SaveLoad.slots();
    expect(slots).toHaveLength(SAVE_SLOTS);
    expect(slots.every((s) => !s.used)).toBe(true);
  });

  it('round-trips a save, with enough to describe it in a list', () => {
    SaveLoad.save({ hello: 'world' }, 42, 2, { gameId: 'pocket', round: 7 });

    const slots = SaveLoad.slots();
    expect(slots[1].used).toBe(true);
    expect(slots[1].gameId).toBe('pocket');
    expect(slots[1].round).toBe(7);
    expect(slots[0].used).toBe(false);

    expect(SaveLoad.load(2)?.state).toEqual({ hello: 'world' });
    expect(SaveLoad.load(1)).toBeNull();
  });

  it('finds the most recent slot for a one-press continue', () => {
    SaveLoad.save({ a: 1 }, 1, 1);
    SaveLoad.save({ b: 2 }, 1, 3);
    expect(SaveLoad.mostRecent()?.slot).toBe(3);
  });

  it('migrates a pre-slot save into slot 1 rather than losing it', () => {
    localStorage.setItem('monopoly_forge_save', JSON.stringify({
      version: '0.1.0', timestamp: 1, seed: 1, state: { old: true },
    }));
    expect(SaveLoad.slots()[0].used).toBe(true);
    expect(SaveLoad.load(1)?.state).toEqual({ old: true });
    // …and the old key is gone, so it cannot be migrated twice.
    expect(localStorage.getItem('monopoly_forge_save')).toBeNull();
  });

  it('does not let a legacy save overwrite a slot somebody saved deliberately', () => {
    SaveLoad.save({ deliberate: true }, 1, 1);
    localStorage.setItem('monopoly_forge_save', JSON.stringify({
      version: '0.1.0', timestamp: 1, seed: 1, state: { old: true },
    }));
    expect(SaveLoad.load(1)?.state).toEqual({ deliberate: true });
  });

  it('refuses a save this build cannot read', () => {
    localStorage.setItem('monopoly_forge_save_1', JSON.stringify({
      version: '0.0.1', timestamp: 1, seed: 1, state: {},
    }));
    expect(SaveLoad.load(1)).toBeNull();
    expect(SaveLoad.slots()[0].used).toBe(false);
  });
});
