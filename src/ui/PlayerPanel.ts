import Phaser from 'phaser';
import type { Player } from '@/game/Player';
import { TOKEN_LABELS } from '@/config';
import { bus } from '@/utils/EventBus';

const TOKEN_COLORS: Record<string, number> = {
  topHat:      0x444444,
  car:         0xe74c3c,
  dog:         0xe67e22,
  battleship:  0x3498db,
  iron:        0x95a5a6,
  boot:        0x8b4513,
  wheelbarrow: 0x2ecc71,
  thimble:     0xf1c40f,
};

interface Row {
  bg:         Phaser.GameObjects.Rectangle;
  activeLine: Phaser.GameObjects.Rectangle;
  dot:        Phaser.GameObjects.Arc;
  tokenText:  Phaser.GameObjects.Text;
  nameText:   Phaser.GameObjects.Text;
  cashText:   Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  switchBtn:  Phaser.GameObjects.Text;
}

export class PlayerPanel {
  private scene:   Phaser.Scene;
  private rows:    Row[] = [];
  private x:       number;
  private y:       number;
  private width:   number;
  private rowH     = 58;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number) {
    this.scene = scene;
    this.x     = x;
    this.y     = y;
    this.width = width;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  init(players: Player[]): void {
    // Destroy old rows
    this.rows.forEach((r) => {
      r.bg.destroy(); r.activeLine.destroy(); r.dot.destroy();
      r.tokenText.destroy(); r.nameText.destroy();
      r.cashText.destroy(); r.statusText.destroy(); r.switchBtn.destroy();
    });
    this.rows = [];

    players.forEach((p, i) => {
      const ry = this.y + i * this.rowH;
      const cx = this.x + this.width;    // right edge of panel

      // Row background
      const bg = this.scene.add.rectangle(
        this.x, ry, this.width, this.rowH - 2, 0x1a2640,
      ).setOrigin(0, 0);

      // Left active indicator bar
      const activeLine = this.scene.add.rectangle(
        this.x, ry, 3, this.rowH - 2, 0x4488ff,
      ).setOrigin(0, 0).setVisible(false);

      // Token colour dot
      const color = TOKEN_COLORS[p.token] ?? 0x888888;
      const dot = this.scene.add.circle(this.x + 13, ry + 14, 7, color)
        .setStrokeStyle(1, 0xffffff);

      // Token name (small, top line)
      const tokenText = this.scene.add.text(this.x + 26, ry + 5,
        TOKEN_LABELS[p.token] ?? p.token,
        { fontFamily: 'Georgia, serif', fontSize: '10px', color: '#7788aa' },
      );

      // Player name
      const nameText = this.scene.add.text(this.x + 26, ry + 18,
        p.name,
        { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ddeeff', fontStyle: 'bold' },
      );

      // Cash
      const cashText = this.scene.add.text(this.x + 26, ry + 34,
        `$${p.cash.toLocaleString()}`,
        { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#f0c040' },
      );

      // Status tag (right-aligned)
      const statusText = this.scene.add.text(cx - 4, ry + 5, '',
        { fontFamily: 'Georgia, serif', fontSize: '9px', color: '#aaaaaa' },
      ).setOrigin(1, 0);

      // "▶" switch button — bottom-right
      const switchBtn = this.scene.add.text(cx - 4, ry + this.rowH - 16, '▶ TAKE TURN',
        {
          fontFamily: 'Georgia, serif', fontSize: '9px', color: '#7799cc',
          backgroundColor: '#1e3055', padding: { x: 5, y: 3 },
        },
      ).setOrigin(1, 1).setInteractive({ useHandCursor: true });

      switchBtn.on('pointerover', () => switchBtn.setStyle({ color: '#aaccff' }));
      switchBtn.on('pointerout',  () => switchBtn.setStyle({ color: '#7799cc' }));
      switchBtn.on('pointerdown', () => {
        bus.emit('debug:forcePlayer', { index: i });
      });

      this.rows.push({ bg, activeLine, dot, tokenText, nameText, cashText, statusText, switchBtn });
    });
  }

  update(players: Player[], activeId: string): void {
    players.forEach((p, i) => {
      const row = this.rows[i];
      if (!row) return;

      const isActive   = p.id === activeId;
      const isBankrupt = p.isBankrupt;

      // Background tint
      row.bg.setFillStyle(isActive ? 0x1e3454 : isBankrupt ? 0x1a1a1a : 0x1a2640);
      row.activeLine.setVisible(isActive);

      // Cash colour
      row.cashText.setText(`$${p.cash.toLocaleString()}`);
      row.cashText.setColor(isBankrupt ? '#555566' : '#f0c040');

      // Name colour
      row.nameText.setColor(isBankrupt ? '#555566' : isActive ? '#ffffff' : '#ddeeff');

      // Status
      const status = isBankrupt ? '💀 bankrupt'
                   : p.inJail   ? '🔒 jail'
                   : isActive   ? '▶ active'
                   : '';
      row.statusText.setText(status);
      row.statusText.setColor(
        isBankrupt ? '#664444' :
        p.inJail   ? '#cc9900' :
        isActive   ? '#44ff88' : '#aaaaaa',
      );

      // Hide switch button for active/bankrupt player
      row.switchBtn.setVisible(!isActive && !isBankrupt);
    });
  }
}
