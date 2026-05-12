import { bus } from '@/utils/EventBus';
import type { Player } from './Player';
import type { Board } from './Board';
import type { Dice } from './Dice';

export type TurnPhase =
  | 'WAITING_FOR_ROLL'
  | 'ROLLING'
  | 'MOVING'
  | 'LANDING'
  | 'AWAITING_BUY_DECISION'
  | 'END_TURN';

export class TurnManager {
  private players: Player[];
  private board:   Board;
  private dice:    Dice;

  currentPlayerIndex: number = 0;
  phase: TurnPhase = 'WAITING_FOR_ROLL';

  // Re-entry guard: GameScene sets this; TurnManager checks it
  private _turnEndedThisRound = false;

  constructor(players: Player[], board: Board, dice: Dice) {
    this.players = players;
    this.board   = board;
    this.dice    = dice;

    // GoToJailTile (and cards with action 'goToJail') emit jail:enter without
    // going through sendToJail(), so player.inJail / position / jailTurns never
    // get set.  When sendToJail() fires (3-doubles case) it sets inJail=true
    // BEFORE emitting, so we guard on !player.inJail to avoid double-applying.
    bus.on('jail:enter', ({ playerId }: { playerId: string }) => {
      const player = this.players.find((p) => p.id === playerId);
      if (!player) return;
      if (player.inJail) {
        // Already jailed by sendToJail() (3-doubles path) — nothing to do.
        console.log(`[TurnManager] jail:enter received for ${player.name} — state already set by sendToJail()`);
        return;
      }
      console.log(
        `[TurnManager] jail:enter received for ${player.name} (external trigger — tile or card). ` +
        `Setting inJail=true, position=10, jailTurns=0 (was position=${player.position})`,
      );
      player.inJail    = true;
      player.jailTurns = 0;
      player.position  = 10;
    });
  }

  get currentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  startTurn(): void {
    this._turnEndedThisRound = false;
    this.phase = 'WAITING_FOR_ROLL';
    console.log(`[TurnManager] startTurn: player=${this.currentPlayer.name} (${this.currentPlayer.id}), position=${this.currentPlayer.position}`);
    bus.emit('turn:start', { playerId: this.currentPlayer.id });
  }

  rollDice(): void {
    if (this.phase !== 'WAITING_FOR_ROLL') return;

    this.phase = 'ROLLING';
    const result = this.dice.roll();
    bus.emit('dice:result', result);

    const player = this.currentPlayer;

    if (player.inJail) {
      this.handleJailRoll(player, result.isDoubles, result.total);
      return;
    }

    if (result.isDoubles) {
      player.doublesStreak++;
      if (player.doublesStreak >= 3) {
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
    this.phase = 'LANDING';
    const player = this.currentPlayer;

    console.log(
      `[TurnManager] resolveLanding: currentPlayer=${player.name} (${player.id}), ` +
      `position=${player.position}, phase=${this.phase}`,
    );

    // Guard: NaN, Infinity, or any out-of-range value must not reach getTile.
    if (!Number.isFinite(player.position) || player.position < 0 || player.position > 39) {
      console.error(`[TurnManager] resolveLanding: ${player.name} position=${player.position} — resetting to 0`);
      player.position = 0;
    }

    const tile = this.board.getTile(player.position);
    console.log(
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

  /** Pay $50 jail fine before rolling */
  payJailFine(player: Player): void {
    if (!player.inJail) return;
    player.pay(50);
    player.inJail   = false;
    player.jailTurns = 0;
    bus.emit('jail:exit',       { playerId: player.id, method: 'fine' });
    bus.emit('ui:notification', { message: `${player.name} paid $50 jail fine.`, type: 'warning' });
    this.phase = 'WAITING_FOR_ROLL';
  }

  /** Use a Get Out of Jail Free card */
  useGetOutOfJailCard(player: Player): void {
    if (!player.inJail || player.getOutOfJailCards <= 0) return;
    player.getOutOfJailCards--;
    player.inJail    = false;
    player.jailTurns = 0;
    bus.emit('jail:exit',       { playerId: player.id, method: 'card' });
    bus.emit('ui:notification', { message: `${player.name} used a Get Out of Jail Free card!`, type: 'success' });
    this.phase = 'WAITING_FOR_ROLL';
  }

  /**
   * The single point where a turn ends.
   * All GameScene event handlers must call this through the guarded wrapper below.
   */
  endTurn(): void {
    if (this._turnEndedThisRound) {
      console.warn(
        `[TurnManager] endTurn BLOCKED by re-entry guard — ` +
        `player=${this.currentPlayer.name}, phase=${this.phase}`,
      );
      return;
    }
    console.log(`[TurnManager] endTurn: player=${this.currentPlayer.name}, phase=${this.phase}`);
    this._turnEndedThisRound = true;
    this.phase = 'END_TURN';
    bus.emit('turn:end', { playerId: this.currentPlayer.id });

    if (this.dice.lastResult?.isDoubles && !this.currentPlayer.inJail) {
      // Same player rolls again
      this.startTurn();
    } else {
      this.advancePlayer();
    }
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

  private movePlayer(player: Player, steps: number, isDoubles: boolean): void {
    this.phase = 'MOVING';

    // Sanitise position — NaN, Infinity, or any out-of-range value cascades.
    if (!Number.isFinite(player.position) || player.position < 0 || player.position > 39) {
      console.error(`[TurnManager] movePlayer: ${player.name} position=${player.position} — resetting to 0`);
      player.position = 0;
    }

    const from            = player.position;
    const { to, passedGo } = this.board.move(from, steps);

    if (steps <= 0) {
      console.error(
        `[TurnManager] movePlayer: ${player.name} received invalid steps=${steps} — move aborted. ` +
        `Check Dice.roll() / PRNG.next() output.`,
      );
      this.endTurn();
      return;
    }

    console.log(
      `[TurnManager] movePlayer: ${player.name} | ` +
      `pos ${from} + ${steps} steps → ${to}` +
      (passedGo ? ' (passed GO)' : '') +
      (isDoubles ? ' [doubles]' : ''),
    );

    if (passedGo) {
      this.board.getTile(0).onPass(player.id);  // emits rent:pay reason:'go'
    }

    player.position = to;
    bus.emit('player:move', { playerId: player.id, from, to, steps, isDoubles });
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
      if (player.jailTurns >= 3) {
        player.pay(50);
        player.inJail    = false;
        player.jailTurns = 0;
        bus.emit('jail:exit',       { playerId: player.id, method: 'forced' });
        bus.emit('ui:notification', { message: `${player.name} paid $50 forced jail fine.`, type: 'warning' });
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
        console.log(`[TurnManager] jail:stay emitted for ${player.name} — deferring endTurn to GameScene`);
        bus.emit('jail:stay', { playerId: player.id });
      }
    }
  }

  private sendToJail(player: Player): void {
    // NOTE: no player:move emitted here — GameScene snaps the token via jail:enter
    player.inJail    = true;
    player.jailTurns = 0;
    player.position  = 10;
    bus.emit('jail:enter', { playerId: player.id, reason: 'doubles' });
  }

  private advancePlayer(): void {
    const active = this.players.filter((p) => !p.isBankrupt);
    if (active.length <= 1) {
      bus.emit('game:end', { winnerId: active[0]?.id ?? null });
      return;
    }
    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    } while (this.currentPlayer.isBankrupt);
    this.startTurn();
  }

  toJSON() {
    return { currentPlayerIndex: this.currentPlayerIndex, phase: this.phase };
  }
}
