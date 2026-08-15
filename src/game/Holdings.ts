import { Registry } from '@/utils/Registry';
import type { Player } from './Player';

// ─── Holdings ─────────────────────────────────────────────────────────────────
// Things a player *has* that the engine has never heard of.
//
// `Player` holds cash, a position, deeds and Get Out of Jail Free cards, and
// until M12b a game could add nothing to that list. That single gap is why six
// of Ultimate Monopoly's printed rules ship reduced — travel vouchers, stock
// certificates and Roll Three cards are all things you *hold*, and each had to
// become something spent the instant it was earned because there was nowhere to
// keep it.
//
// A holding is **countable**, keyed by kind. That is enough for all three: a
// stock company is its own kind (`stock.acmeMotors`) rather than a bag of
// objects with identity, which keeps the whole thing a `Record<string, number>`
// and therefore trivially saveable. A holding that needed identity would be a
// card, and cards already have a home.
//
// Four things this must not get wrong, three of which the engine has been bitten
// by before:
//
//   * **The snapshot carries it**, and `validateSnapshot` refuses a save naming
//     a kind this build has not registered — the rule a turn order already gets.
//   * **Bankruptcy is explicit.** `transferEstate` moves or forfeits them by
//     name. A bankrupt player's cards were once simply destroyed, and the deck
//     census caught it a hundred games later.
//   * **An invariant counts them**, so a rule that mints one and loses it fails
//     a batch rather than a season.
//   * **A bot can price one**, or holdings are things it will neither ask for
//     nor part with.

export interface HoldingKind {
  /** What one is called. */
  label: string;
  /** What several are called. Defaults to `label` + "s". */
  plural?: string;
  /** Most a player may hold at once, if there is a limit. */
  limit?: number;
  /**
   * What one is worth in cash, so a bot can price it in a trade and an estate
   * can be valued. A kind with no answer is worth nothing and is simply not
   * traded — which is honest, rather than a guess that makes a bot pay for it.
   */
  value?: number;
  /**
   * What happens to them when the holder goes bankrupt. `transfer` hands them to
   * the creditor with the deeds; `forfeit` returns them to nobody. Defaults to
   * `transfer`, which is what the deeds do.
   */
  onBankruptcy?: 'transfer' | 'forfeit';
}

export const HOLDINGS = new Registry<HoldingKind>('holdings');

export function registerHolding(name: string, kind: HoldingKind): void {
  HOLDINGS.set(name, kind);
}

export function knownHoldings(): string[] {
  return HOLDINGS.names();
}

export function holdingKind(name: string): HoldingKind | undefined {
  return HOLDINGS.get(name);
}

/** `3 travel vouchers`, `1 travel voucher` — for a panel, a log or a trade. */
export function describeHolding(name: string, count: number): string {
  const kind = HOLDINGS.get(name);
  if (!kind) return `${count} × ${name}`;
  const noun = count === 1 ? kind.label : (kind.plural ?? `${kind.label}s`);
  return `${count} ${noun}`;
}

// ─── Moving them about ────────────────────────────────────────────────────────
// Free functions rather than methods on `Player`, so the *rules* about a kind —
// its limit, what it is worth — stay next to the registry that defines them and
// `Player` stays a bag of state.

/** How many of a kind this player holds. */
export function countHeld(player: Player, name: string): number {
  return player.holdings[name] ?? 0;
}

/**
 * Add some, respecting the kind's limit. Returns how many were actually given —
 * a caller that minted three into a limit of one needs to know it gave one.
 */
export function giveHolding(player: Player, name: string, count = 1): number {
  if (count <= 0) return 0;
  const limit = HOLDINGS.get(name)?.limit;
  const held  = countHeld(player, name);
  const given = limit === undefined ? count : Math.max(0, Math.min(count, limit - held));
  if (given > 0) player.holdings[name] = held + given;
  return given;
}

/** Take some. Returns how many were actually taken, never going below zero. */
export function takeHolding(player: Player, name: string, count = 1): number {
  const held  = countHeld(player, name);
  const taken = Math.max(0, Math.min(count, held));
  if (taken <= 0) return 0;
  if (held - taken === 0) delete player.holdings[name];
  else player.holdings[name] = held - taken;
  return taken;
}

/** Everything this player holds, in registration order, skipping empty kinds. */
export function heldByPlayer(player: Player): Array<{ name: string; count: number }> {
  return knownHoldings()
    .map((name) => ({ name, count: countHeld(player, name) }))
    .filter((entry) => entry.count > 0);
}

/** What a player's holdings are worth in cash, for a valuation or an estate. */
export function valueOfHoldings(player: Player): number {
  return heldByPlayer(player).reduce(
    (sum, { name, count }) => sum + count * (HOLDINGS.get(name)?.value ?? 0), 0,
  );
}
