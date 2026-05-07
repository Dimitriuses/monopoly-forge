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
  }

  get currentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  startTurn(): void {
    this._turnEndedThisRound = false;
    this.phase = 'WAITING_FOR_ROLL';
    bus.emit('turn:start', { playerId: this.currentPlayer.id });
  }

  rollDice(): void {
    if (this.phase !== 'WAITING_FOR_ROLL') return;

    this.phase = 'ROLLING';
    console.log(`${this.currentPlayer.name} rolls the dice...`);
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
    console.log(`${this.currentPlayer.name} lands on ${this.board.getTile(this.currentPlayer.position).name}`);
    const player = this.currentPlayer;
    const tile   = this.board.getTile(player.position);
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
    console.log(`${player.name} pays $50 jail fine.`);
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
    console.log(`${player.name} uses a Get Out of Jail Free card.`);
  }

  /**
   * The single point where a turn ends.
   * All GameScene event handlers must call this through the guarded wrapper below.
   */
  endTurn(): void {
    if (this._turnEndedThisRound) return;   // ← re-entry guard
    this._turnEndedThisRound = true;
    this.phase = 'END_TURN';
    console.log(`${this.currentPlayer.name} ends their turn.`);
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
    console.log(`${player.name} moves ${steps} steps.`);
    const from            = player.position;
    const { to, passedGo } = this.board.move(from, steps);

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
        this.endTurn();
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
