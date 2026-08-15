import { rng } from '@/utils/PRNG';
import { bus } from '@/utils/EventBus';
import { dlog } from '@/utils/log';
import { isOwnable } from '@/tiles/Tile';
import { Dice, type DiceResult, type RollContext } from './Dice';
import { registerVariant } from './Variants';
import { registerRollRule, rollRuleNamed } from './RollRules';
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
// Both rules this variant used to leave out are in now: "roll a triple and move
// anywhere" (M10a, once a roll rule could say what a triple meant and a prompt
// existed that a bot could answer), and "the speed die is not used until you have
// been round once" (M13b, once a roll could be told whose it was). What the first
// needed was a pick-a-tile prompt that both a person and a bot answer, and
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
  /** The number the third die showed, or null on a picture face. Triples need it. */
  lastNumber: number | null = null;

  override roll(ctx?: RollContext): DiceResult {
    const white = super.roll(ctx);

    // "The speed die is not used until you have been round the board once."
    // Before that this is an ordinary pair of dice, which is what the printed
    // rule says and what the first lap of a real game feels like.
    if (ctx?.player && !ctx.player.hasLapped) {
      this.lastFace = null;
      this.lastNumber = null;
      this.lastResult = white;
      return white;
    }
    // Third draw from the same stream as the other two: a seeded speed-die game
    // is reproducible, it is simply not the same game as a two-dice one.
    const index = Math.min(SPEED_FACES.length - 1, Math.floor(rng.next() * SPEED_FACES.length));
    const face  = SPEED_FACES[index];

    this.lastFace   = typeof face === 'number' ? null : face;
    this.lastNumber = typeof face === 'number' ? face : null;
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
  return board.scan(
    player.position, (tile) => isOwnable(tile) && tile.ownerId !== player.id,
  );
}

/** The bus: on to the next card tile. */
function nextDrawTile(board: Board, player: Player): number | null {
  return board.scan(
    player.position, (tile) => tile.type === 'chance' || tile.type === 'communityChest',
  );
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

  const from = player.position;
  const path = ctx.board.pathTo(from, target);
  if (path === null || path.length === 0) return;

  // A bonus move to a tile the rule went looking for, not a count of pips.
  ctx.board.announcePassing(path, player.id, { roll: null });
  player.position = target;

  bus.emit('ui:notification', {
    message: face === 'mrMonopoly'
      ? `🎩 Mr. Monopoly sends ${player.name} to ${ctx.board.getTile(target).name}.`
      : `🚌 ${player.name} takes the bus to ${ctx.board.getTile(target).name}.`,
    type: 'info',
  });
  dlog(`[SpeedDie] ${face}: ${player.name} ${from} → ${target} (${path.length} steps)`);

  // The same contract a card's move has: emit, and let the animation's landing
  // resolve it. `hold()` parks the turn until that landing ends it, at which
  // point `GameScene.safeEndTurn` resumes the walk instead of ending twice.
  bus.emit('player:move', {
    playerId: player.id, from, to: target, path, steps: path.length, isDoubles: false,
  });
  ctx.hold();
}

// ─── Registration ─────────────────────────────────────────────────────────────

// ─── Triples ──────────────────────────────────────────────────────────────────

export const TRIPLES_RULE = 'speedDieTriples';

/**
 * "If you roll TRIPLE 1's, 2's, or 3's, move ahead to any space on the board. Do
 * not roll again. You do not go to jail if you've rolled DOUBLES twice before
 * rolling TRIPLES."
 *
 * Deferred from 8b for two missing pieces, both of which exist now: a rule set
 * could not say what a *triple* meant (`game/RollRules.ts`), and nothing could
 * ask a player to pick a square that a bot could also answer
 * (`game/Choice.ts`). The weight offered to a bot is the tile's price, so a bot
 * takes the dearest thing it can reach — which is what a person does with the
 * same prompt.
 */
registerRollRule(TRIPLES_RULE, (ctx) => {
  const { result, player, board, dice } = ctx;
  const face = dice instanceof SpeedDice ? dice.lastNumber : null;

  // A triple is the two white dice matching *and* the speed die showing the same
  // number. The speed die only numbers 1–3, so only those can ever be tripled.
  const triple = face !== null && result.isDoubles && result.die1 === face;

  if (triple) {
    // Explicitly *before* the doubles streak is consulted: a triple after two
    // doubles is not a third pair, and the printed rule says so in as many words.
    player.doublesStreak = 0;
    const asked = ctx.choose(
      `Triple ${face}s — move to any space`,
      board.tiles.map((tile, id) => ({
        id: String(id),
        label: tile.name,
        tileId: id,
        weight: 'price' in tile ? (tile as { price: number }).price : 0,
      })),
      (optionId) => bus.emit('roll:chosen', { playerId: player.id, tileId: Number(optionId) }),
    );
    // Nobody listening means no prompt and no answer coming, so fall through to
    // an ordinary move rather than parking the turn for ever.
    if (asked) return { kind: 'handled' };
  }

  return rollRuleNamed('classic')(ctx);
});

registerVariant('speedDie', {
  label: 'Speed die',
  blurb: 'A third die: 1–3 add to your roll, Mr. Monopoly and the bus move you again',
  dice: () => new SpeedDice(),
  rules: { rollRule: TRIPLES_RULE },
  apply: (flow: TurnFlow) => {
    if (flow.has(SPEED_BONUS_PHASE)) return;
    flow.insertAfter('AWAITING_BUY_DECISION', { name: SPEED_BONUS_PHASE, onEnter: bonusMove });
  },
});
