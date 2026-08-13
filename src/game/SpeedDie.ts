import { rng } from '@/utils/PRNG';
import { bus } from '@/utils/EventBus';
import { dlog } from '@/utils/log';
import { isOwnable } from '@/tiles/Tile';
import { Dice, type DiceResult } from './Dice';
import { registerVariant } from './Variants';
import type { Board } from './Board';
import type { Player } from './Player';
import type { PhaseContext, TurnFlow } from './TurnFlow';

// ─── The speed die ────────────────────────────────────────────────────────────
// The variant M6 tried to ship as a boolean and deleted instead, because it is
// not one: a third die changes what a roll *is*, and two of its faces add a step
// to the turn. It is the first thing built on the phase pipeline, and it was
// written without opening `TurnManager` — which was the point of building the
// pipeline before anything else in 8b.
//
// What it needs, and where each piece comes from:
//
//   * a third die         → `Variant.dice`, because `TurnManager` is handed its
//                           dice and never makes them
//   * the picture faces   → a phase inserted before `END_TURN`, which holds the
//                           turn while the token walks and is resumed by the
//                           landing, exactly as a card's move is
//   * doubles, unchanged  → `SpeedDice` reports `isDoubles` from the two white
//                           dice, so the three-doubles jail rule is untouched
//
// Deliberately *not* implemented: the official "roll a triple and move anywhere"
// rule, and "the speed die is not used until you have been round once". The
// first needs a pick-a-tile prompt that both a person and a bot must answer, and
// the second is a per-player flag that would have to go in the snapshot. Both
// are real work, neither is a face effect, and half of either would be worse
// than none. See KNOWNISSUES.

/** 1–3 add to the roll; the two picture faces move you again afterwards. */
export type SpeedFace = 1 | 2 | 3 | 'mrMonopoly' | 'bus';

/** The real die: three numbers, two buses and Mr. Monopoly. */
export const SPEED_FACES: readonly SpeedFace[] = [1, 2, 3, 'bus', 'bus', 'mrMonopoly'];

export const SPEED_BONUS_PHASE = 'SPEED_BONUS';

export class SpeedDice extends Dice {
  /**
   * The picture face waiting to be acted on, or null. Held here rather than on
   * `DiceResult` so `Dice` knows nothing about a variant — and *consumed* when
   * the bonus phase acts on it, which is what stops the phase running twice when
   * the walk it started resumes the turn through it.
   */
  lastFace: SpeedFace | null = null;

  override roll(): DiceResult {
    const white = super.roll();
    // Third draw from the same stream as the other two: a seeded speed-die game
    // is reproducible, it is simply not the same game as a two-dice one.
    const index = Math.min(SPEED_FACES.length - 1, Math.floor(rng.next() * SPEED_FACES.length));
    const face  = SPEED_FACES[index];

    this.lastFace = typeof face === 'number' ? null : face;
    // `isDoubles` stays the two white dice: the third die is not part of a pair,
    // so three doubles still means jail and nothing about that rule changes.
    this.lastResult = {
      ...white,
      total: white.total + (typeof face === 'number' ? face : 0),
    };
    dlog(`[SpeedDice] third die: ${face} → total ${this.lastResult.total}`);
    return this.lastResult;
  }
}

// ─── The bonus move ───────────────────────────────────────────────────────────

/**
 * Mr. Monopoly: on to the next deed that is not already yours — unowned, and you
 * get the buy prompt; owned by somebody else, and you pay them. That single rule
 * covers both halves of the official one and needs no special case, because the
 * ordinary landing already knows how to do each.
 */
function nextForeignDeed(board: Board, player: Player): number | null {
  return scanForward(board, player.position, (id) => {
    const tile = board.getTile(id);
    return isOwnable(tile) && tile.ownerId !== player.id;
  });
}

/** The bus: on to the next card tile. */
function nextDrawTile(board: Board, player: Player): number | null {
  return scanForward(board, player.position, (id) => {
    const type = board.getTile(id).type;
    return type === 'chance' || type === 'communityChest';
  });
}

/** The first tile forward from `from` that matches, skipping the one you are on. */
function scanForward(board: Board, from: number, matches: (id: number) => boolean): number | null {
  for (let step = 1; step <= board.size; step++) {
    const id = board.move(from, step).to;
    if (matches(id)) return id;
  }
  return null;
}

/**
 * The extra step. It runs on the way to `END_TURN` — a turn that ended without a
 * move, a jailed player, a bankrupt one, all reach here too, so it checks.
 */
function bonusMove(ctx: PhaseContext): void {
  const dice = ctx.dice;
  if (!(dice instanceof SpeedDice) || dice.lastFace === null) return;

  // Consumed before anything else can go wrong: the walk this move starts comes
  // back through this phase when the landing resumes the turn, and an unconsumed
  // face would send the player round the board for ever.
  const face = dice.lastFace;
  dice.lastFace = null;

  const player = ctx.player;
  if (player.inJail || player.isBankrupt) return;

  const target = face === 'mrMonopoly'
    ? nextForeignDeed(ctx.board, player)
    : nextDrawTile(ctx.board, player);
  if (target === null) {
    dlog(`[SpeedDie] ${face}: this board has nowhere to send ${player.name}`);
    return;
  }

  const from  = player.position;
  const steps = ctx.board.stepsBetween(from, target);
  if (steps === 0) return;

  const { passedGo } = ctx.board.move(from, steps);
  if (passedGo) ctx.board.getTile(ctx.board.anchor('start')).onPass(player.id);
  player.position = target;

  bus.emit('ui:notification', {
    message: face === 'mrMonopoly'
      ? `🎩 Mr. Monopoly sends ${player.name} to ${ctx.board.getTile(target).name}.`
      : `🚌 ${player.name} takes the bus to ${ctx.board.getTile(target).name}.`,
    type: 'info',
  });
  dlog(`[SpeedDie] ${face}: ${player.name} ${from} → ${target} (${steps} steps)`);

  // The same contract a card's move has: emit, and let the animation's landing
  // resolve it. `hold()` parks the turn until that landing ends it, at which
  // point `GameScene.safeEndTurn` resumes the walk instead of ending twice.
  bus.emit('player:move', { playerId: player.id, from, to: target, steps, isDoubles: false });
  ctx.hold();
}

// ─── Registration ─────────────────────────────────────────────────────────────

registerVariant('speedDie', {
  label: 'Speed die',
  blurb: 'A third die: 1–3 add to your roll, Mr. Monopoly and the bus move you again',
  dice: () => new SpeedDice(),
  apply: (flow: TurnFlow) => {
    if (flow.has(SPEED_BONUS_PHASE)) return;
    flow.insertAfter('AWAITING_BUY_DECISION', { name: SPEED_BONUS_PHASE, onEnter: bonusMove });
  },
});
