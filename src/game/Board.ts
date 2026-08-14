import { Tile, type TileDefinition } from '@/tiles/Tile';
import { createTile } from '@/tiles/registry';
import { resolveRules, type GameRules } from './Rules';
import { CLASSIC_MAP } from '@/maps/classic';
import type { GameMap } from '@/maps/GameMap';
import {
  computeGeometry, type BoardGeometry, type Backdrop, type TileLayout,
} from './BoardLayout';
import {
  movementNamed, type MovementStrategy, type StepContext, type TrackSpec,
} from './Movement';
import { PropertyTile } from '@/tiles/PropertyTile';

export type { BoardSide, TileLayout, Backdrop, LayoutSpec } from './BoardLayout';

/** Where a walk ended, and every tile it set foot on getting there. */
export interface MoveResult {
  to: number;
  /** Tiles stepped onto, in order, `to` last. Excludes the starting tile. */
  path: number[];
  /** The walk reached the `start` anchor going forwards. */
  passedGo: boolean;
}

/**
 * The roles the rules ask for by name instead of by index. A map declares which
 * tile plays each part; nothing in the model should hardcode "jail is tile 10".
 */
export type BoardAnchor = 'start' | 'jail' | 'goToJail';

const ANCHOR_OF_TYPE: Partial<Record<Tile['type'], BoardAnchor>> = {
  go:       'start',
  jail:     'jail',
  goToJail: 'goToJail',
};

export class Board {
  readonly tiles: Tile[];
  /** Number of tiles in a full circuit — every wrap-around goes through this. */
  readonly size: number;
  /** The map this board was built from, including the shape it is drawn in. */
  readonly map: GameMap;
  /**
   * The rule set in force. A board no longer *has* an economy of its own — the
   * game that deals this board supplies one, and the player's switches go over
   * it. Everything the board builds reads it from here.
   */
  readonly rules: GameRules;
  private geometry: BoardGeometry;
  private anchors: Map<BoardAnchor, number>;
  /** What one step forward means here — see `game/Movement.ts`. */
  private movement: MovementStrategy;
  /** The loops the tiles form. A board with none declared is one loop. */
  readonly tracks: TrackSpec[];
  /** Junction lookup, both ways round, so a step can ask in either direction. */
  private junctions: Map<number, number>;

  /**
   * Takes a map, or a bare tile list for the tests that only care about the
   * circuit. A bare list is laid out as a square, which is what it used to be.
   */
  constructor(
    source: GameMap | TileDefinition[] = CLASSIC_MAP,
    ruleOverrides?: Partial<GameRules>,
  ) {
    this.map = Array.isArray(source)
      ? { ...CLASSIC_MAP, id: 'inline', name: 'Inline', tiles: source }
      : source;

    // The classic rules, then whatever the game and the player put over them.
    this.rules = resolveRules(ruleOverrides);
    // What kinds of tile exist is a registry, not a switch — see tiles/registry.ts.
    this.tiles = this.map.tiles.map((def) => createTile(def, this.rules));
    this.size     = this.tiles.length;
    this.anchors  = this.resolveAnchors();
    this.geometry = computeGeometry(this.map.layout, this.size);

    // No declared tracks means one loop over everything, which is what every
    // board was before M11 and what `circuit` would assume regardless.
    this.tracks = this.map.tracks?.length
      ? this.map.tracks
      : [{ id: 'circuit', from: 0, count: this.size }];
    this.junctions = new Map();
    for (const { a, b } of this.map.junctions ?? []) {
      this.junctions.set(a, b);
      this.junctions.set(b, a);
    }
    this.movement = movementNamed(this.rules.movement);
  }

  getTile(index: number): Tile {
    if (!Number.isFinite(index)) {
      throw new Error(`[Board] getTile: non-finite index ${index}`);
    }
    const i = Math.floor(index) % this.size;
    const tile = this.tiles[i];
    if (tile === undefined) {
      throw new Error(`[Board] getTile(${index}): slot ${i} is undefined (tiles.length=${this.tiles.length})`);
    }
    return tile;
  }

  getLayout(index: number): TileLayout {
    if (!Number.isFinite(index)) {
      throw new Error(`[Board] getLayout: non-finite index ${index}`);
    }
    const i = Math.floor(index) % this.size;
    const layout = this.geometry.tiles[i];
    if (layout === undefined) {
      throw new Error(`[Board] getLayout(${index}): slot ${i} is undefined`);
    }
    return layout;
  }

  /**
   * Walk `steps` tiles and report where you went, not just where you arrived.
   *
   * `path` is every tile stepped *onto*, in order, ending at `to` — it excludes
   * the tile you started on. The tokens follow it rather than recomputing the
   * route, which is the only way an animation can show a player crossing tracks,
   * and it is what lets a driver fire `onPass` for every tile underfoot instead
   * of the one special case GO used to be.
   *
   * `passedGo` is kept because a lot of code and several tests read it, and it
   * still means what it always did: the walk reached the `start` anchor going
   * forwards. Going *backwards* over GO has never paid and still does not.
   */
  move(from: number, steps: number, ctx: Partial<StepContext> = {}): MoveResult {
    if (!Number.isFinite(from) || !Number.isFinite(steps)) {
      throw new Error(`[Board] move() non-finite: from=${from}, steps=${steps}`);
    }
    const s         = Math.floor(steps);
    const direction = s < 0 ? -1 : 1;
    const step      = { direction, crossing: ctx.crossing ?? false } as const;

    const path: number[] = [];
    // Normalised up front, not by the first step: a zero-step move never enters
    // the loop, and returning the raw `from` would hand back the out-of-range
    // index this has sanitised since the beginning.
    let at = ((Math.floor(from) % this.size) + this.size) % this.size;
    for (let i = 0; i < Math.abs(s); i++) {
      at = this.movement.next(this, at, step);
      path.push(at);
    }

    const start = this.tryAnchor('start');
    return {
      to: at,
      path,
      passedGo: direction === 1 && start !== null && path.includes(start),
    };
  }

  /**
   * Distance going forwards from `from` to `to`, staying on the current track.
   * On one circuit this is the subtraction it always was; with tracks it is what
   * you can reach without changing loop, and `pathTo` is the one to ask when the
   * destination may be on another.
   */
  stepsBetween(from: number, to: number): number {
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new Error(`[Board] stepsBetween() non-finite: from=${from}, to=${to}`);
    }
    const target = Math.floor(to);
    let at = Math.floor(from);
    for (let steps = 0; steps <= this.size; steps++) {
      if (at === target) return steps;
      at = this.movement.next(this, at, { direction: 1, crossing: false });
    }
    return 0;
  }

  /**
   * The shortest forward route from `from` to `to`, crossing tracks where it has
   * to, or null when there is none. A breadth-first search rather than a
   * subtraction, because on a board with junctions "how far" has no closed form —
   * and on a single circuit it returns exactly what the subtraction did.
   *
   * This is what a card that names a tile uses. The printed rule agrees: if a
   * card sends you to a property on another track, you take the transit station
   * on the way.
   */
  pathTo(from: number, to: number): number[] | null {
    if (from === to) return [];
    const seen = new Set<number>([from]);
    let frontier: Array<{ at: number; path: number[] }> = [{ at: from, path: [] }];

    for (let depth = 0; depth < this.size && frontier.length; depth++) {
      const next: typeof frontier = [];
      for (const { at, path } of frontier) {
        for (const step of this.stepsFrom(at)) {
          if (seen.has(step)) continue;
          const route = [...path, step];
          if (step === to) return route;
          seen.add(step);
          next.push({ at: step, path: route });
        }
      }
      frontier = next;
    }
    return null;
  }

  /**
   * The nearest tile forward that matches, by number of steps, or null. Breadth
   * first for the same reason `pathTo` is: "nearest" on a board with junctions
   * means fewest steps, which is not the same as lowest index.
   */
  scan(from: number, matches: (tile: Tile, id: number) => boolean): number | null {
    const seen = new Set<number>([from]);
    let frontier = [from];

    for (let depth = 0; depth < this.size && frontier.length; depth++) {
      const next: number[] = [];
      for (const at of frontier) {
        for (const step of this.stepsFrom(at)) {
          if (seen.has(step)) continue;
          if (matches(this.getTile(step), step)) return step;
          seen.add(step);
          next.push(step);
        }
      }
      frontier = next;
    }
    return null;
  }

  /**
   * Fire `onPass` for every tile a forward walk set foot on — **the landing tile
   * included**. That last word is the whole rule, and it is what makes a pay
   * corner expressible: passing GO has always paid, and landing exactly on GO
   * has always paid too, which used to be a special case spelled `passedGo` and
   * is now simply what "you were on it" means.
   *
   * So `onPass` is *what a tile charges you for being there* and `onLand` is
   * what else happens. A corner that pays more for stopping pays the difference
   * in `onLand`; a corner that pays the same pays nothing extra. Every built-in
   * except GO has an empty `onPass`, so nothing about the classic board moves.
   *
   * Forward walks only. Going back three spaces over GO has never paid a salary
   * and must not start now — `move` reports `direction` through `passedGo`, and
   * the one caller that walks backwards does not call this.
   */
  announcePassing(path: number[], playerId: string): void {
    for (const id of path) this.getTile(id).onPass(playerId);
  }

  /** Every tile one step forward from here — two of them at a junction. */
  private stepsFrom(at: number): number[] {
    const straight = this.movement.next(this, at, { direction: 1, crossing: false });
    const crossed  = this.movement.next(this, at, { direction: 1, crossing: true });
    return straight === crossed ? [straight] : [straight, crossed];
  }

  // ─── Topology ────────────────────────────────────────────────────────────────
  // Asked by the `tracks` strategy, and answered here because the board is what
  // holds the map. A board with no declared tracks is one loop, which is what
  // every board was before M11 and what `circuit` assumes anyway.

  /** The loop a tile belongs to. */
  trackOf(id: number): TrackSpec {
    const track = this.tracks.find((t) => id >= t.from && id < t.from + t.count);
    if (!track) throw new Error(`[Board] tile ${id} is on no track`);
    return track;
  }

  /** The other half of the space this tile is one half of, or null. */
  junctionPartner(id: number): number | null {
    return this.junctions.get(id) ?? null;
  }

  // ─── Anchors ─────────────────────────────────────────────────────────────────

  /** Index of the tile playing `role`. Throws — a map without a jail cannot jail. */
  anchor(role: BoardAnchor): number {
    const index = this.anchors.get(role);
    if (index === undefined) {
      throw new Error(`[Board] no tile plays the "${role}" role on this map`);
    }
    return index;
  }

  tryAnchor(role: BoardAnchor): number | null {
    return this.anchors.get(role) ?? null;
  }

  /** Every property tile in a colour group, in board order. */
  groupTiles(group: string): PropertyTile[] {
    return this.tiles.filter(
      (t): t is PropertyTile => t instanceof PropertyTile && t.group === group,
    );
  }

  private resolveAnchors(): Map<BoardAnchor, number> {
    const found = new Map<BoardAnchor, number>();
    this.tiles.forEach((tile, i) => {
      const role = ANCHOR_OF_TYPE[tile.type];
      if (role !== undefined && !found.has(role)) found.set(role, i);
    });
    return found;
  }

  // ─── Geometry ────────────────────────────────────────────────────────────────
  // Where the tiles sit is the map's business, not the board's: see
  // game/BoardLayout.ts. The board only forwards the answers.

  /** The board's own outline — a square, a circle, whatever the map asked for. */
  get backdrop(): Backdrop {
    return this.geometry.backdrop;
  }

  /** Middle of the board, for the centrepiece and anything drawn inside it. */
  get centre(): { x: number; y: number } {
    return this.geometry.centre;
  }

  toJSON() {
    return { tiles: this.tiles.map((t) => t.toJSON()) };
  }
}
