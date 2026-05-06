import Phaser from 'phaser';
import type { Player } from '@/game/Player';
import { TOKEN_LABELS } from '@/config';

const TOKEN_COLORS: Record<string, number> = {
  topHat:     0x222222,
  car:        0xe74c3c,
  dog:        0xe67e22,
  battleship: 0x3498db,
  iron:       0x95a5a6,
  boot:       0x8b4513,
  wheelbarrow:0x2ecc71,
  thimble:    0xf1c40f,
};

interface Row {
  bg:       Phaser.GameObjects.Rectangle;
  dot:      Phaser.GameObjects.Arc;
  nameText: Phaser.GameObjects.Text;
  cashText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
}

export class PlayerPanel {
  private scene:   Phaser.Scene;
  private rows:    Row[] = [];
  private players: Player[] = [];
  private x:       number;
  private y:       number;
  private width:   number;
  private rowH:    number = 52;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number) {
    this.scene = scene;
    this.x     = x;
    this.y     = y;
    this.width = width;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  init(players: Player[]): void {
    this.players = players;
    this.rows.forEach((r) => {
      r.bg.destroy(); r.dot.destroy();
      r.nameText.destroy(); r.cashText.destroy(); r.statusText.destroy();
    });
    this.rows = [];

    players.forEach((p, i) => {
      const ry = this.y + i * this.rowH;

      const bg = this.scene.add.rectangle(
        this.x, ry, this.width, this.rowH - 2, 0x1e2a45,
      ).setOrigin(0, 0).setAlpha(0.9);

      const color = TOKEN_COLORS[p.token] ?? 0xffffff;
      const dot = this.scene.add.circle(this.x + 14, ry + this.rowH / 2, 8, color);

      const nameText = this.scene.add.text(
        this.x + 28, ry + 6,
        `${TOKEN_LABELS[p.token]}`,
        { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#aaaacc' },
      );

      const cashText = this.scene.add.text(
        this.x + 28, ry + 20,
        `$${p.cash.toLocaleString()}`,
        { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#f0c040', fontStyle: 'bold' },
      );

      const statusText = this.scene.add.text(
        this.x + 28, ry + 36,
        p.name,
        { fontFamily: 'Georgia, serif', fontSize: '10px', color: '#888899' },
      );

      this.rows.push({ bg, dot, nameText, cashText, statusText });
    });
  }

  /** Refresh cash amounts and highlight the active player */
  update(players: Player[], activeId: string): void {
    this.players = players;
    players.forEach((p, i) => {
      const row = this.rows[i];
      if (!row) return;

      const isActive = p.id === activeId;
      const isOut    = p.isBankrupt;

      row.bg.setFillStyle(isActive ? 0x2e4a7a : 0x1e2a45);
      row.cashText.setText(`$${p.cash.toLocaleString()}`);
      row.cashText.setColor(isOut ? '#888888' : '#f0c040');

      const status = isOut
        ? '💀 bankrupt'
        : p.inJail
          ? '🔒 in jail'
          : isActive
            ? '▶ rolling…'
            : '';
      row.statusText.setText(status);
    });
  }
}
