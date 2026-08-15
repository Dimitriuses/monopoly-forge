import type { TileType } from '@/tiles/Tile';

// ─── The build ladder ─────────────────────────────────────────────────────────
// What may be built, on what, and what it does. Until M12d this was two fields
// on a lot — `houses: number` and `hasHotel: boolean` — which is the classic
// game's ladder hard-coded into the shape of the data. Ultimate Monopoly builds
// five different things and the classic pair could express two of them.
//
// A level is one *kind* of building. The rungs a tile can climb are the levels
// that apply to its type, flattened: four houses then a hotel is five rungs, and
// a lot's `level` is which rung it stands on (0 = bare). That number is also the
// index into the tile's rent table, which is what makes the whole thing cheap —
// `rentTiers[level]` replaces `hasHotel ? tiers[5] : tiers[houses]`.
//
// **Two shapes, not one.** The reference is what forced the design:
//
//   * a **house / hotel / skyscraper** stands on a lot, needs the whole colour
//     group, must go up evenly across it, and charges the *next rent tier*;
//   * a **train depot / cab stand** stands on a railroad or a cab company, needs
//     nothing but the deed, and *doubles* whatever that tile charges — "you
//     don't need to own multiple Railroads before building a Train Depot on
//     one", and "a Train Depot doubles the rent due for the Railroad".
//
// One mechanism covers both because a level says which of those it is, rather
// than the engine growing a second kind of improvement beside the first.

export interface BuildLevel {
  /** `house`, `hotel`, `skyscraper`, `trainDepot`, `cabStand`. */
  id: string;
  label: string;
  /** How many of these may stand on one tile before the next kind is allowed. */
  perTile: number;
  /** How many the bank stocks. Finite, and running out is a rule. */
  supply: number;
  /** Tile types this may be built on. */
  on: TileType[];
  /**
   * What one costs. When absent the tile's own `houseCost` is charged, which is
   * how every lot works; a depot has one price wherever it stands.
   */
  cost?: number;
  /** Half of it comes back on a sale, unless the level says otherwise. */
  refund?: number;
  /**
   * What standing here does to the rent. `'tier'` steps to the next tier of the
   * tile's own rent table — so a level that charges one needs a tier to read.
   * A multiplier scales whatever the tile would otherwise have charged, which
   * is the only way to improve something that prices itself off how many its
   * owner holds.
   */
  effect: 'tier' | { multiply: number };
  /**
   * How much of the colour group this level wants before it may be built.
   *
   * - `'group'` — every lot in it. The classic rule, and Ultimate Monopoly's
   *   skyscrapers: "if you own all of the properties of a color group, and have
   *   built hotels on each, you may then build Skyscrapers."
   * - `'majority'` — all but one, in a group of more than two: "if a color group
   *   has more than two properties, you may build houses and hotels once you own
   *   all but one property in that color group." A group of two is a group of
   *   two, and needs both.
   * - `false` — nothing but the deed. A train depot on a single railroad.
   *
   * Even building comes with either of the first two, and is measured across the
   * lots the player **owns** rather than the whole group — on a majority the odd
   * lot out belongs to somebody else and would otherwise hold the level at zero
   * for ever.
   */
  group: false | 'group' | 'majority';
}

/** One rung: standing at `level` means `nth` of `kind` on this tile. */
export interface Rung {
  level: number;
  kind: BuildLevel;
  /** Which one of that kind — the third house is `nth: 3`. */
  nth: number;
}

/** The levels that may be built on a tile of this type, in order. */
export function levelsFor(ladder: BuildLevel[], type: TileType): BuildLevel[] {
  return ladder.filter((level) => level.on.includes(type));
}

/**
 * The rungs a tile of this type can climb, flattened. `rungs[0]` is level 1 —
 * level 0 is bare and has no rung.
 */
export function rungsFor(ladder: BuildLevel[], type: TileType): Rung[] {
  const rungs: Rung[] = [];
  for (const kind of levelsFor(ladder, type)) {
    for (let nth = 1; nth <= kind.perTile; nth++) {
      rungs.push({ level: rungs.length + 1, kind, nth });
    }
  }
  return rungs;
}

/** The highest level a tile of this type can reach — 5 on the classic board. */
export function topLevel(ladder: BuildLevel[], type: TileType): number {
  return rungsFor(ladder, type).length;
}

/** What stands on a tile at this level, or null when it is bare. */
export function rungAt(ladder: BuildLevel[], type: TileType, level: number): Rung | null {
  return rungsFor(ladder, type)[level - 1] ?? null;
}

/**
 * What is actually standing there: the kind and how many of it.
 *
 * Level 3 on the classic board is three houses; level 5 is one hotel, *not* four
 * houses and a hotel, because a hotel replaces them. That replacement is what
 * `consumedBy` reports and what the bank has to be handed back.
 */
export function standingOn(
  ladder: BuildLevel[], type: TileType, level: number,
): { kind: BuildLevel; count: number } | null {
  const rung = rungAt(ladder, type, level);
  return rung ? { kind: rung.kind, count: rung.nth } : null;
}

/**
 * What goes back to the bank when a tile climbs from `level` to `level + 1`,
 * and what has to come out of it going the other way.
 *
 * Buying the hotel returns four houses; selling it takes four back out, which is
 * why a hotel cannot be sold when the bank is short of houses. Nothing is
 * exchanged between two rungs of the same kind — the third house just joins the
 * other two.
 */
export function consumedBy(
  ladder: BuildLevel[], type: TileType, level: number,
): { kind: BuildLevel; count: number } | null {
  const below = standingOn(ladder, type, level);
  const at    = rungAt(ladder, type, level + 1);
  if (!below || !at || at.kind.id === below.kind.id) return null;
  return below;
}

/** What one costs on this tile: the level's own price, or the tile's. */
export function costOf(kind: BuildLevel, tileHouseCost: number): number {
  return kind.cost ?? tileHouseCost;
}

/** What selling one pays back — half, unless the level says otherwise. */
export function refundOf(kind: BuildLevel, tileHouseCost: number): number {
  return kind.refund ?? Math.floor(costOf(kind, tileHouseCost) / 2);
}

/** Every kind the ladder knows, deduplicated — what the bank stocks. */
export function buildingKinds(ladder: BuildLevel[]): BuildLevel[] {
  return ladder;
}

/** A level by id, for the places that ask about houses and hotels by name. */
export function levelById(ladder: BuildLevel[], id: string): BuildLevel | null {
  return ladder.find((level) => level.id === id) ?? null;
}
