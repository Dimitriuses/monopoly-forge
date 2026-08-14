import { bus } from '@/utils/EventBus';
import { dlog, dwarn } from '@/utils/log';
import { TurnFlow, type TurnPhase } from './TurnFlow';
import type { Player } from './Player';
import type { Board } from './Board';
import type { Dice } from './Dice';

export type { TurnPhase };

export class TurnManager {
  private players: Player[];
  private board:   Board;
  private dice:    Dice;

  /** What a turn is made of, and who decides who plays next — see `TurnFlow`. */
  readonly flow: TurnFlow;

  currentPlayerIndex: number = 0;
  phase: TurnPhase = 'WAITING_FOR_ROLL';

  /** Completed passes round the table, counted from 1. Part of the game state. */
  round: number = 1;
  /** Who has already played this round — how a round is counted whatever the
   *  turn order does, since "the index wrapped" only holds for seat order. */
  private seatsThisRound = new Set<string>();

  // Re-entry guard: GameScene sets this; TurnManager checks it
  private _turnEndedThisRound = false;
  /** A phase asked the turn to wait. Cleared by `resume()`. */
  private _held = false;

  constructor(players: Player[], board: Board, dice: Dice, flow?: TurnFlow) {
    this.players = players;
    this.board   = board;
    this.dice    = dice;
    this.flow    = flow ?? new TurnFlow(board.rules);

    // GoToJailTile (and cards with action 'goToJail') emit jail:enter without
    // going through sendToJail(), so player.inJail / position / jailTurns never
    // get set.  When sendToJail() fires (3-doubles case) it sets inJail=true
    // BEFORE emitting, so we guard on !player.inJail to avoid double-applying.
    bus.on('jail:enter', ({ playerId }: { playerId: string }) => {
      const player = this.players.find((p) => p.id === playerId);
      if (!player) return;
      if (player.inJail) {
        // Already jailed by sendToJail() (3-doubles path) — nothing to do.
        dlog(`[TurnManager] jail:enter received for ${player.name} — state already set by sendToJail()`);
        return;
      }
      const jail = this.board.anchor('jail');
      dlog(
        `[TurnManager] jail:enter received for ${player.name} (external trigger — tile or card). ` +
        `Setting inJail=true, position=${jail}, jailTurns=0 (was position=${player.position})`,
      );
      player.inJail    = true;
      player.jailTurns = 0;
      player.position  = jail;
    });
  }

  get currentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  startTurn(): void {
    this._turnEndedThisRound = false;
    this._held = false;
    this.seatsThisRound.add(this.currentPlayer.id);
    this.enterPhase('WAITING_FOR_ROLL', null);
    dlog(`[TurnManager] startTurn: player=${this.currentPlayer.name} (${this.currentPlayer.id}), position=${this.currentPlayer.position}, round=${this.round}`);
    bus.emit('turn:start', { playerId: this.currentPlayer.id });
  }

  rollDice(): void {
    if (this.phase !== 'WAITING_FOR_ROLL') return;

    // Thrown first, and the phase entered second, so anything a rule set hangs
    // on ROLLING sees the dice and can still say something about them — a
    // variant that adds a third die works from there rather than from in here.
    this.dice.roll();
    this.enterPhase('ROLLING');
    const result = this.dice.lastResult!;
    bus.emit('dice:result', result);

    const player = this.currentPlayer;

    if (player.inJail) {
      this.handleJailRoll(player, result.isDoubles, result.total);
      return;
    }

    if (result.isDoubles) {
      player.doublesStreak++;
      if (player.doublesStreak >= this.board.rules.doublesToJail) {
        player.doublesStreak = 0;
        this.sendToJail(player);
        return;
      }
    } else {
      player.doublesStreak = 0;
    }

    this.movePlayer(player, result.total, result.isDoubles);
  }

  /** Called by GameScene after the move tween completes */
  resolveLanding(): void {
    this.enterPhase('LANDING');
    const player = this.currentPlayer;

    dlog(
      `[TurnManager] resolveLanding: currentPlayer=${player.name} (${player.id}), ` +
      `position=${player.position}, phase=${this.phase}`,
    );

    // Guard: NaN, Infinity, or any out-of-range value must not reach getTile.
    if (!this.isOnBoard(player.position)) {
      console.error(`[TurnManager] resolveLanding: ${player.name} position=${player.position} — resetting to 0`);
      player.position = 0;
    }

    const tile = this.board.getTile(player.position);
    dlog(
      `[TurnManager] onLand → tile[${player.position}] "${tile.name}" (${tile.type}) ` +
      `for player=${player.name}`,
    );
    tile.onLand(player.id);
  }

  confirmBuy(): void {
    this.endTurn();
  }

  declineBuy(): void {
    this.endTurn();
  }

  /** Pay the jail fine before rolling */
  payJailFine(player: Player): void {
    if (!player.inJail) return;
    // The amount actually handed over — the Free Parking house rule pots it.
    const paid = Math.min(this.board.rules.jailFine, player.cash);
    player.pay(paid);
    player.inJail   = false;
    player.jailTurns = 0;
    bus.emit('jail:exit',       { playerId: player.id, method: 'fine', amount: paid });
    bus.emit('ui:notification', { message: `${player.name} paid $${paid} jail fine.`, type: 'warning' });
    this.enterPhase('WAITING_FOR_ROLL');
  }

  /** Use a Get Out of Jail Free card */
  useGetOutOfJailCard(player: Player): void {
    if (!player.inJail || player.getOutOfJailCards <= 0) return;
    // The card goes out with the event so it can be put back in its deck —
    // GameScene owns the decks and does that. Nothing else consumes it.
    const card = player.jailCards.pop();
    player.inJail    = false;
    player.jailTurns = 0;
    bus.emit('jail:exit',       { playerId: player.id, method: 'card', card });
    bus.emit('ui:notification', { message: `${player.name} used a Get Out of Jail Free card!`, type: 'success' });
    this.enterPhase('WAITING_FOR_ROLL');
  }

  /**
   * The single point where a turn ends.
   * All GameScene event handlers must call this through the guarded wrapper below.
   */
  endTurn(): void {
    if (this._turnEndedThisRound) {
      dwarn(
        `[TurnManager] endTurn BLOCKED by re-entry guard — ` +
        `player=${this.currentPlayer.name}, phase=${this.phase}`,
      );
      return;
    }
    dlog(`[TurnManager] endTurn: player=${this.currentPlayer.name}, phase=${this.phase}`);
    this._turnEndedThisRound = true;
    this.walkToEnd();
  }

  /**
   * Carry on a turn a phase asked to hold. The re-entry guard stays set across
   * the wait, so a held turn still cannot be ended twice.
   */
  resume(): void {
    if (!this._held) return;
    dlog(`[TurnManager] resume from ${this.phase}`);
    this._held = false;
    this.walkToEnd();
  }

  /** Whether the turn is parked in a phase waiting for `resume()`. */
  get isHeld(): boolean {
    return this._held;
  }

  /**
   * DEV TOOL — force the active player to the given index.
   * Only works when a tween isn't running (GameScene checks isAnimating first).
   */
  forcePlayerTurn(index: number): void {
    if (index < 0 || index >= this.players.length) return;
    if (this.players[index].isBankrupt) return;
    this._turnEndedThisRound = true; // suppress any pending endTurn from the old turn
    this.currentPlayerIndex  = index;
    this.startTurn();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Enter a phase: record it, run whatever the rule set attached to it, and tell
   * the table. This is the only place `phase` is written, which is what makes a
   * phase a rule set added indistinguishable from one the engine ships.
   */
  private enterPhase(name: TurnPhase, from: TurnPhase | null = this.phase): void {
    this.phase = name;
    this.flow.get(name)?.onEnter?.({
      player:  this.currentPlayer,
      players: this.players,
      board:   this.board,
      dice:    this.dice,
      from,
      hold:    () => { this._held = true; },
    });
    bus.emit('turn:phase', { playerId: this.currentPlayer.id, phase: name, from });
  }

  /**
   * Walk whatever is left of the turn and then hand over. Only phases the model
   * drives itself are entered here — `MOVING` and the rest are already behind us
   * by the time a turn is ending, and re-entering them would be nonsense — so on
   * the classic flow this is `END_TURN` and nothing else. A rule set that put a
   * step in gets it run right here, and may `hold()` to wait for something.
   */
  private walkToEnd(): void {
    for (const spec of this.flow.remaining(this.phase)) {
      this.enterPhase(spec.name);
      if (this._held) {
        dlog(`[TurnManager] turn held at ${this.phase} — waiting for resume()`);
        return;
      }
    }
    bus.emit('turn:end', { playerId: this.currentPlayer.id });
    this.advancePlayer();
  }

  private movePlayer(player: Player, steps: number, isDoubles: boolean): void {
    this.enterPhase('MOVING');

    // Sanitise position — NaN, Infinity, or any out-of-range value cascades.
    if (!this.isOnBoard(player.position)) {
      console.error(`[TurnManager] movePlayer: ${player.name} position=${player.position} — resetting to 0`);
      player.position = 0;
    }

    const from = player.position;
    // Parity is the rule at a junction: an even roll rides the transit station
    // to the other track, an odd one stays put. On a board with no junctions
    // this changes nothing, because there is nowhere to cross.
    const { to, path, passedGo } = this.board.move(from, steps, { crossing: steps % 2 === 0 });

    if (steps <= 0) {
      console.error(
        `[TurnManager] movePlayer: ${player.name} received invalid steps=${steps} — move aborted. ` +
        `Check Dice.roll() / PRNG.next() output.`,
      );
      this.endTurn();
      return;
    }

    dlog(
      `[TurnManager] movePlayer: ${player.name} | ` +
      `pos ${from} + ${steps} steps → ${to}` +
      (passedGo ? ' (passed GO)' : '') +
      (isDoubles ? ' [doubles]' : ''),
    );

    this.board.announcePassing(path, player.id);

    player.position = to;
    bus.emit('player:move', { playerId: player.id, from, to, path, steps, isDoubles });
  }

  private handleJailRoll(player: Player, isDoubles: boolean, _total: number): void {
    if (isDoubles) {
      player.inJail        = false;
      player.jailTurns     = 0;
      player.doublesStreak = 0;
      bus.emit('jail:exit',       { playerId: player.id, method: 'doubles' });
      bus.emit('ui:notification', { message: `${player.name} rolled doubles — out of jail!`, type: 'success' });
      // Move WITHOUT a doubles bonus turn (isDoubles=false prevents re-roll)
      this.movePlayer(player, this.dice.lastResult!.total, false);
    } else {
      player.jailTurns++;
      if (player.jailTurns >= this.board.rules.jailTerm) {
        const paid = Math.min(this.board.rules.jailFine, player.cash);
        player.pay(paid);
        player.inJail    = false;
        player.jailTurns = 0;
        bus.emit('jail:exit',       { playerId: player.id, method: 'forced', amount: paid });
        bus.emit('ui:notification', { message: `${player.name} paid $${paid} forced jail fine.`, type: 'warning' });
        this.movePlayer(player, this.dice.lastResult!.total, false);
      } else {
        bus.emit('ui:notification', {
          message: `${player.name} stays in jail (turn ${player.jailTurns}/3).`,
          type: 'warning',
        });
        // Do NOT call endTurn() directly here. This method is called from within
        // rollBtn's pointerdown callback. Calling endTurn() → advancePlayer() →
        // startTurn() → setRollEnabled(true) → rollBtn.setInteractive() all
        // synchronously inside that callback leaves Phaser's input system in a
        // broken state: rollBtn is re-registered mid-event, and the next player's
        // roll button is silently dead until the jailed player exits jail (at which
        // point endTurn fires asynchronously from an animation callback).
        // Emitting jail:stay lets GameScene call safeEndTurn(100), moving the
        // entire turn-advance out of the pointerdown call stack.
        dlog(`[TurnManager] jail:stay emitted for ${player.name} — deferring endTurn to GameScene`);
        bus.emit('jail:stay', { playerId: player.id });
      }
    }
  }

  private sendToJail(player: Player): void {
    // NOTE: no player:move emitted here — GameScene snaps the token via jail:enter
    player.inJail    = true;
    player.jailTurns = 0;
    player.position  = this.board.anchor('jail');
    bus.emit('jail:enter', { playerId: player.id, reason: 'doubles' });
  }

  /** A finite index inside the map — the shape every position guard checks. */
  private isOnBoard(position: number): boolean {
    return Number.isFinite(position) && position >= 0 && position < this.board.size;
  }

  /**
   * Hand the turn on — or end the game. Neither decision is made here any more:
   * both come from the flow, so a variant supplies teams, a reversed table or a
   * round limit without this file knowing about any of them. The win condition
   * is asked *first*, so a player who bankrupts the last opponent on a doubles
   * roll ends the game instead of rolling again into an empty table.
   */
  private advancePlayer(): void {
    const next = this.flow.nextSeat({
      players: this.players, current: this.currentPlayerIndex,
      board:   this.board,   dice:    this.dice,
      round:   this.round,   rules:   this.flow.rules,
    });
    if (next === null) {
      bus.emit('game:end', { winnerId: null });
      return;
    }

    // A round is over when play reaches somebody who has already had a turn in
    // it — which holds whatever order the rule set uses, where "the index
    // wrapped" only holds for seat order. Rolling doubles is the same seat
    // taking another go, not a new round.
    const wraps = next !== this.currentPlayerIndex
               && this.seatsThisRound.has(this.players[next].id);
    // The win condition is asked about the round that is *about to start*, so a
    // limit of one round ends the game when everybody has had one turn rather
    // than one turn later. The counter only moves if the game carries on.
    const round = wraps ? this.round + 1 : this.round;

    const outcome = this.flow.outcome({
      players: this.players, board: this.board, round, rules: this.flow.rules,
    });
    if (outcome) {
      dlog(`[TurnManager] game over in round ${this.round} — winner=${outcome.winnerId ?? 'nobody'}`);
      bus.emit('game:end', { winnerId: outcome.winnerId });
      return;
    }

    if (wraps) {
      this.round = round;
      this.seatsThisRound.clear();
    }
    this.currentPlayerIndex = next;
    this.startTurn();
  }

  toJSON() {
    return { currentPlayerIndex: this.currentPlayerIndex, phase: this.phase, round: this.round };
  }

  /** The round state a save has to carry — `round` alone would drift on reload. */
  captureRound(): { round: number; seatsThisRound: string[] } {
    return { round: this.round, seatsThisRound: [...this.seatsThisRound] };
  }

  restoreRound(saved: { round: number; seatsThisRound: string[] }): void {
    this.round = saved.round;
    this.seatsThisRound = new Set(saved.seatsThisRound);
  }
}
