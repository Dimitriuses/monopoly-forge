import Phaser from 'phaser';
import type { Player } from '@/game/Player';

export class UIScene extends Phaser.Scene {
  private diceText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // ── Panel background ──────────────────────────────────────────────────────
    this.add.rectangle(1050, 0, 230, 800, 0x16213e).setOrigin(0);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add.text(1165, 20, 'MONOPOLY\nFORGE', {
      fontFamily: 'Georgia, serif',
      fontSize: '16px',
      color: '#f0c040',
      align: 'center',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    // ── Turn indicator ────────────────────────────────────────────────────────
    this.turnText = this.add.text(1165, 110, "Player 1's Turn", {
      fontFamily: 'Georgia, serif',
      fontSize: '14px',
      color: '#ffffff',
      wordWrap: { width: 200 },
      align: 'center',
    }).setOrigin(0.5, 0);

    // ── Dice display ──────────────────────────────────────────────────────────
    this.add.text(1165, 170, '🎲 Last Roll', {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#aaaacc',
    }).setOrigin(0.5, 0);

    this.diceText = this.add.text(1165, 195, '— | —', {
      fontFamily: 'Georgia, serif', fontSize: '22px', color: '#f0c040',
    }).setOrigin(0.5, 0);

    // ── Listen for game events from GameScene ─────────────────────────────────
    this.events.on('dice:result', ({ die1, die2 }: { die1: number; die2: number }) => {
      this.diceText.setText(`${die1} | ${die2}`);
    });

    this.events.on('turn:start', ({ player }: { player: Player | undefined }) => {
      if (player) this.turnText.setText(`${player.name}'s\nTurn`);
    });
  }
}
