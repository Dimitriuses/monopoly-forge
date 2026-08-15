import type { TileDefinition, TileType } from '@/tiles/Tile';
import type { LayoutSpec } from '@/game/BoardLayout';
import type { JunctionSpec, TrackSpec } from '@/game/Movement';
import { isKnownTileType } from '@/tiles/registry';

// ─── GameMap ──────────────────────────────────────────────────────────────────
// A board as data: the tiles in circuit order, and the shape they are laid out
// in. Nothing here is Phaser, and nothing here is the classic board — the classic
// board is just the first map that happens to ship.
//
// `validateMap` is the gate for everything that makes a *board* coherent: ids
// that match the circuit, anchors the rules resolve by name, colour groups that
// can be completed, a shape the tile count can make.
//
// What it deliberately does *not* check is anything about a pairing — a deck
// against this board, a rule set against this build. Those are `validateGame`'s,
// because the same deck is valid next to a different board and the same board is
// valid under a different economy. Until M9a a map carried both, and a board was
// declaring how much money you start with.

export interface GameMap {
  id: string;
  name: string;
  /** One-line description, shown wherever a map can be chosen. */
  blurb: string;
  tiles: TileDefinition[];
  layout: LayoutSpec;
  /**
   * The loops the tiles form, when they form more than one. Left out — as every
   * board did before M11 — the whole tile list is a single circuit, which is
   * what the `circuit` movement strategy assumes and what `layout: rings` has
   * always drawn: three rings of *one* loop.
   *
   * Declaring tracks is a statement about **topology**, not about drawing. A
   * board may have three tracks and be laid out as a square; it may be drawn as
   * three rings and be one track. `rules.movement` is what decides which
   * strategy walks them.
   */
  tracks?: TrackSpec[];
  /**
   * Pairs of tiles that are one space — a railroad and the transit station
   * beside it. Only meaningful with `tracks`; see `game/Movement.ts`.
   */
  junctions?: JunctionSpec[];
}

export interface MapProblem {
  where: string;
  problem: string;
}

/** Tile types the rules need a map to provide exactly one of. */
const REQUIRED_ANCHORS: TileType[] = ['go', 'jail'];

export function validateMap(map: GameMap): MapProblem[] {
  const problems: MapProblem[] = [];
  const complain = (where: string, problem: string) => problems.push({ where, problem });

  if (map.tiles.length === 0) {
    complain(map.id, 'a map needs at least one tile');
    return problems;
  }

  // ── Ids line up with the circuit, and every type is one the engine knows ────
  map.tiles.forEach((tile, index) => {
    if (tile.id !== index) {
      complain(`tile ${index}`, `its id is ${tile.id}; ids must match position in the circuit`);
    }
    if (!tile.name?.trim()) complain(`tile ${index}`, 'has no name');
    if (!isKnownTileType(tile.type)) {
      complain(tile.name || `tile ${index}`, `has unregistered type "${tile.type}"`);
    }
  });

  // ── Anchors the rules ask for by role ───────────────────────────────────────
  for (const type of REQUIRED_ANCHORS) {
    const found = map.tiles.filter((t) => t.type === type).length;
    if (found === 0) complain(map.id, `no "${type}" tile — the rules resolve that role by name`);
  }

  // ── Property groups ─────────────────────────────────────────────────────────
  const groups = new Map<string, TileDefinition[]>();
  for (const tile of map.tiles) {
    if (tile.type !== 'property') continue;
    if (!tile.group) {
      complain(tile.name, 'is a property with no colour group');
      continue;
    }
    // How *many* tiers is a question about the game's build ladder, and a map
     // has no economy — `validateGame` is where the two meet. All a board can
     // say on its own is that a lot has to charge something bare and something
     // built.
    if (!tile.rent || tile.rent.length < 2) {
      complain(tile.name, 'needs at least two rent tiers: bare, and one built');
    }
    if (!tile.price || !tile.houseCost || !tile.mortgage) {
      complain(tile.name, 'needs a price, a house cost and a mortgage value');
    }
    const list = groups.get(tile.group) ?? [];
    list.push(tile);
    groups.set(tile.group, list);
  }

  for (const [group, tiles] of groups) {
    if (tiles.length < 2) {
      complain(`group ${group}`, `has only ${tiles.length} lot — a group cannot be completed`);
    }
    const costs = new Set(tiles.map((t) => t.houseCost));
    if (costs.size > 1) {
      complain(`group ${group}`, `mixes house costs (${[...costs].join(', ')})`);
    }
  }

  // ── Ownable tiles need a price ──────────────────────────────────────────────
  for (const tile of map.tiles) {
    if ((tile.type === 'railroad' || tile.type === 'utility') && !tile.price) {
      complain(tile.name, `is a ${tile.type} with no price`);
    }
    if (tile.type === 'tax' && !tile.amount) {
      complain(tile.name, 'is a tax tile with no amount');
    }
  }

  // ── The shape has to fit the tiles ──────────────────────────────────────────
  problems.push(...validateLayout(map));
  problems.push(...validateTracks(map));

  return problems;
}

/**
 * Tracks have to tile the board exactly — contiguous, in order, no gaps and no
 * overlaps — because `trackOf` finds a tile's loop by range and a tile in no
 * loop is a tile a player can walk onto and never leave.
 *
 * A junction has to join *different* tracks, for the same reason: one that
 * joined a track to itself would be a step that silently teleports.
 */
function validateTracks(map: GameMap): MapProblem[] {
  const tracks = map.tracks;
  const problems: MapProblem[] = [];

  if (!tracks?.length) {
    if (map.junctions?.length) {
      problems.push({ where: map.id, problem: 'has junctions but no tracks for them to join' });
    }
    return problems;
  }

  let expected = 0;
  for (const track of tracks) {
    if (track.count < 2) {
      problems.push({ where: `track ${track.id}`, problem: 'needs at least two tiles' });
    }
    if (track.from !== expected) {
      problems.push({
        where: `track ${track.id}`,
        problem: `starts at tile ${track.from}; tracks must run end to end, so it should start at ${expected}`,
      });
    }
    expected = track.from + track.count;
  }
  if (expected !== map.tiles.length) {
    problems.push({
      where: map.id,
      problem: `its tracks cover ${expected} tiles but it has ${map.tiles.length}`,
    });
  }

  const trackAt = (id: number) => tracks.find((t) => id >= t.from && id < t.from + t.count);
  for (const { a, b } of map.junctions ?? []) {
    const [ta, tb] = [trackAt(a), trackAt(b)];
    if (!ta || !tb) {
      problems.push({ where: `junction ${a}–${b}`, problem: 'joins a tile that is on no track' });
    } else if (ta === tb) {
      problems.push({
        where: `junction ${a}–${b}`,
        problem: `joins track "${ta.id}" to itself — a junction crosses between loops`,
      });
    }
  }

  return problems;
}

function validateLayout(map: GameMap): MapProblem[] {
  const count = map.tiles.length;
  const spec = map.layout;

  if (spec.kind === 'square') {
    return (count - 4) % 4 === 0 && count >= 4
      ? []
      : [{ where: map.id, problem: `a square board needs 4n + 4 tiles, not ${count}` }];
  }
  if (spec.kind === 'ring') {
    return count >= 3 ? [] : [{ where: map.id, problem: 'a ring needs at least three tiles' }];
  }

  if (spec.kind === 'squares') {
    const problems: MapProblem[] = [];
    const declared = spec.rings.reduce((n, ring) => n + ring.count, 0);
    if (declared !== count) {
      problems.push({
        where: map.id, problem: `its squares hold ${declared} tiles but it has ${count}`,
      });
    }
    const depth = spec.depth ?? 64;
    spec.rings.forEach((ring, i) => {
      if ((ring.count - 4) % 4 !== 0 || ring.count < 8) {
        problems.push({
          where: `square ${i}`,
          problem: `needs 4n + 4 tiles with at least one a side, not ${ring.count}`,
        });
      }
      if (ring.inset < 0) {
        problems.push({ where: `square ${i}`, problem: 'cannot be inset past the board edge' });
      }
    });
    // Nested squares closer together than a tile is deep would draw on top of
    // each other, the same check the concentric circles get.
    const insets = [...spec.rings].map((r) => r.inset).sort((a, b) => a - b);
    for (let i = 1; i < insets.length; i++) {
      if (insets[i] - insets[i - 1] < depth) {
        problems.push({
          where: map.id,
          problem: `squares inset ${insets[i - 1]} and ${insets[i]} are closer than a tile is deep (${depth})`,
        });
      }
    }
    return problems;
  }

  const declared = spec.rings.reduce((n, ring) => n + ring.count, 0);
  const problems: MapProblem[] = [];
  if (declared !== count) {
    problems.push({ where: map.id, problem: `its rings hold ${declared} tiles but it has ${count}` });
  }
  spec.rings.forEach((ring, i) => {
    if (ring.count < 3) problems.push({ where: `ring ${i}`, problem: 'needs at least three tiles' });
    if (ring.radius <= 0) problems.push({ where: `ring ${i}`, problem: 'needs a positive radius' });
  });
  // Rings that overlap would draw on top of each other.
  const sorted = [...spec.rings].sort((a, b) => a.radius - b.radius);
  const depth = spec.depth ?? 64;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].radius - sorted[i - 1].radius < depth) {
      problems.push({
        where: map.id,
        problem: `rings at radius ${sorted[i - 1].radius} and ${sorted[i].radius} are closer than a tile is deep (${depth})`,
      });
    }
  }
  return problems;
}
