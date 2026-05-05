import Phaser from 'phaser';
import type { Card } from '@/cards/CardDeck';

interface CardSceneData {
  card: Card;
}

export class CardScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CardScene' });
  }

  create(data: CardSceneData): void {
    const { width, height } = this.scale;
    const { card } = data;

    // ── Overlay ───────────────────────────────────────────────────────────────
    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.6)
      .setOrigin(0)
      .setInteractive(); // blocks clicks through

    // ── Card panel ────────────────────────────────────────────────────────────
    const isChance = card.id.startsWith('ch');
    const panelColor = isChance ? 0xf0c040 : 0x87ceeb;
    const labelText  = isChance ? '❓ CHANCE' : '🏘 COMMUNITY CHEST';

    const panel = this.add.rectangle(width / 2, height / 2, 420, 260, panelColor, 1)
      .setStrokeStyle(4, 0xffffff);

    this.tweens.add({
      targets: panel,
      scaleX: { from: 0.2, to: 1 },
      scaleY: { from: 0.2, to: 1 },
      duration: 300,
      ease: 'Back.easeOut',
    });

    this.add.text(width / 2, height / 2 - 90, labelText, {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#222244', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(width / 2, height / 2 - 10, card.description, {
      fontFamily: 'Georgia, serif', fontSize: '18px', color: '#111111',
      wordWrap: { width: 360 }, align: 'center',
    }).setOrigin(0.5).setDepth(10);

    // ── Dismiss button ────────────────────────────────────────────────────────
    const btn = this.add.text(width / 2, height / 2 + 90, 'OK', {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#ffffff',
      backgroundColor: '#27ae60', padding: { x: 28, y: 10 },
    }).setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => {
      this.scene.stop();
      void overlay; // keep linter happy
    });
  }
}
