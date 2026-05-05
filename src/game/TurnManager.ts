import { bus } from '@/utils/EventBus';
import type { Player } from './Player';
import type { Board } from './Board';
import type { Dice } from './Dice';

export type TurnPhase =
  | 'WAITING_FOR_ROLL'
  | 'ROLLING'
  | 'MOVING'
  | 'LANDING'
  | 'BUYING'
  | 'OTHER_ACTION'
  | 'END_TURN';

export class TurnManager {
  private players: Player[];
  private board: Board;
  private dice: Dice;

  currentPlayerIndex: number = 0;
  phase: TurnPhase = 'WAITING_FOR_ROLL';

  constructor(players: Player[], board: Board, dice: Dice) {
    this.players = players;
    this.board = board;
    this.dice = dice;
  }

  get currentPlayer(): Player {
    return this.players[this.currentPlayerIndex];
  }

  // ─── Public API called by GameScene ────────────────────────────────────────

  startTurn(): void {
    this.phase = 'WAITING_FOR_ROLL';
    bus.emit('turn:start', { playerId: this.currentPlayer.id });
  }

  rollDice(): void {
    if (this.phase !== 'WAITING_FOR_ROLL') return;

    this.phase = 'ROLLING';
    const result = this.dice.roll();
    bus.emit('dice:result', result);

    const player = this.currentPlayer;

    // Jail handling
    if (player.inJail) {
      this.handleJailRoll(player, result.isDoubles, result.total);
      return;
    }

    // Doubles streak → jail on 3rd
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

  declineBuy(): void {
    // Trigger auction then end turn
    bus.emit('property:auction', {
      tileId: this.currentPlayer.position,
      playerId: this.currentPlayer.id,
    });
    this.phase = 'END_TURN';
    this.endTurn();
  }

  confirmBuy(): void {
    this.phase = 'END_TURN';
    this.endTurn();
  }

  endTurn(): void {
    this.phase = 'END_TURN';
    bus.emit('turn:end', { playerId: this.currentPlayer.id });

    // Only advance if no doubles (or in jail)
    if (this.dice.lastResult?.isDoubles && !this.currentPlayer.inJail) {
      // Same player rolls again
      this.startTurn();
    } else {
      this.advancePlayer();
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private movePlayer(player: Player, steps: number, isDoubles: boolean): void {
    this.phase = 'MOVING';
    const { to, passedGo } = this.board.move(player.position, steps);

    if (passedGo) {
      this.board.getTile(0).onPass(player.id); // collect $200
    }

    player.position = to;
    bus.emit('player:move', { playerId: player.id, from: player.position, to, isDoubles });

    // Resolve landing after movement tween completes (GameScene listens to 'player:move')
    // and calls resolveLanding().
    this.phase = 'LANDING';
  }

  resolveLanding(): void {
    const player = this.currentPlayer;
    const tile = this.board.getTile(player.position);
    tile.onLand(player.id);
  }

  private handleJailRoll(player: Player, isDoubles: boolean, _total: number): void {
    if (isDoubles) {
      // Exit jail, but no extra turn for doubles from jail
      player.inJail = false;
      player.jailTurns = 0;
      player.doublesStreak = 0;
      bus.emit('jail:exit', { playerId: player.id, method: 'doubles' });
      this.movePlayer(player, this.dice.lastResult!.total, false);
    } else {
      player.jailTurns++;
      if (player.jailTurns >= 3) {
        // Must pay and get out
        bus.emit('tax:pay', { playerId: player.id, amount: 50, tileId: 10 });
        player.inJail = false;
        player.jailTurns = 0;
        bus.emit('jail:exit', { playerId: player.id, method: 'forced' });
        this.movePlayer(player, this.dice.lastResult!.total, false);
      } else {
        // Stay in jail
        this.phase = 'END_TURN';
        this.endTurn();
      }
    }
  }

  private sendToJail(player: Player): void {
    player.inJail = true;
    player.jailTurns = 0;
    player.position = 10; // Jail tile index
    bus.emit('jail:enter', { playerId: player.id, reason: 'doubles' });
    this.phase = 'END_TURN';
    this.endTurn();
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
    return {
      currentPlayerIndex: this.currentPlayerIndex,
      phase: this.phase,
    };
  }
}
