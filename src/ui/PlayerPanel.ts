import Phaser from 'phaser';
import type { Player } from '@/game/Player';
import { TOKEN_LABELS } from '@/config';
import { theme } from './Theme';

interface Row {
  bg:         Phaser.GameObjects.Rectangle;
  activeLine: Phaser.GameObjects.Rectangle;
  dot:        Phaser.GameObjects.Arc;
  tokenText:  Phaser.GameObjects.Text;
  nameText:   Phaser.GameObjects.Text;
  cashText:   Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  chevron:    Phaser.GameObjects.Text;
  /** Under the cursor. Kept here because `update` repaints the background. */
  hovered:    boolean;
}

export class PlayerPanel {
  private scene:   Phaser.Scene;
  private rows:    Row[] = [];
  private x:       number;
  private y:       number;
  private width:   number;
  private rowH     = 58;

  /**
   * What the panel is showing, so a hover can repaint without being handed the
   * table again. `update` is the only thing that computes a row's colours, and a
   * hover has to go through it or the two disagree about a bankrupt seat.
   */
  private shown:    Player[] = [];
  private activeId: string | null = null;

  /** Pressed a seat. Set by `UIScene`; the row is inert without it. */
  onSelect: ((playerId: string) => void) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number) {
    this.scene = scene;
    this.x     = x;
    this.y     = y;
    this.width = width;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  init(players: Player[]): void {
    const t = theme();
    // Destroy old rows
    this.rows.forEach((r) => {
      r.bg.destroy(); r.activeLine.destroy(); r.dot.destroy();
      r.tokenText.destroy(); r.nameText.destroy();
      r.cashText.destroy(); r.statusText.destroy(); r.chevron.destroy();
    });
    this.rows = [];

    players.forEach((p, i) => {
      const ry = this.y + i * this.rowH;
      const cx = this.x + this.width;    // right edge of panel

      // Row background
      const bg = this.scene.add.rectangle(
        this.x, ry, this.width, this.rowH - 2, t.panel.background,
      ).setOrigin(0, 0);

      // Left active indicator bar
      const activeLine = this.scene.add.rectangle(
        this.x, ry, 3, this.rowH - 2, t.log.accent.info,
      ).setOrigin(0, 0).setVisible(false);

      // Token colour dot
      const color = t.tokens[p.token] ?? 0x888888;
      const dot = this.scene.add.circle(this.x + 13, ry + 14, 7, color)
        .setStrokeStyle(1, 0xffffff);

      // Token name (small, top line), with a marker for a seat a bot plays
      const tokenText = this.scene.add.text(this.x + 26, ry + 5,
        `${p.isBot ? '🤖 ' : ''}${TOKEN_LABELS[p.token] ?? p.token}`,
        { fontFamily: t.font.display, fontSize: '10px', color: t.chrome.dim },
      );

      // Player name
      const nameText = this.scene.add.text(this.x + 26, ry + 18,
        p.name,
        { fontFamily: t.font.display, fontSize: '13px', color: t.chrome.text, fontStyle: 'bold' },
      );

      // Cash
      const cashText = this.scene.add.text(this.x + 26, ry + 34,
        `$${p.cash.toLocaleString()}`,
        { fontFamily: t.font.display, fontSize: '13px', color: t.chrome.heading },
      );

      // Status tag (right-aligned)
      const statusText = this.scene.add.text(cx - 4, ry + 5, '',
        { fontFamily: t.font.display, fontSize: '9px', color: t.chrome.dim },
      ).setOrigin(1, 0);

      // A chevron rather than a caption: the row is 225px wide and already
      // carries four lines of text, and "›" is what every other openable row in
      // this build wears (see `ui/Menu.ts`).
      const chevron = this.scene.add.text(cx - 6, ry + (this.rowH - 2) / 2, '›', {
        fontFamily: t.font.display, fontSize: '16px', color: t.chrome.dim,
      }).setOrigin(1, 0.5);

      const row: Row = {
        bg, activeLine, dot, tokenText, nameText, cashText, statusText, chevron,
        hovered: false,
      };

      // The background is the hit area, so the whole row is the target rather
      // than the few pixels the text covers. Safe to register here: `UIScene` is
      // never paused — `GameScene.openPause` pauses only itself — so this is not
      // the "setInteractive on a paused input plugin" trap that CLAUDE.md
      // records against rebuilding chrome from a theme change.
      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => { row.hovered = true;  this.repaint(); })
        .on('pointerout',  () => { row.hovered = false; this.repaint(); })
        .on('pointerdown', () => { this.onSelect?.(p.id); });

      this.rows.push(row);
    });
  }

  update(players: Player[], activeId: string): void {
    const t = theme();
    this.shown    = players;
    this.activeId = activeId;

    players.forEach((p, i) => {
      const row = this.rows[i];
      if (!row) return;

      const isActive   = p.id === activeId;
      const isBankrupt = p.isBankrupt;

      // Background tint. `rowHover` / `rowHoverSelected` are the palette's own
      // answer to "a list row under the cursor", so the active seat stays
      // legible as active while it is being pointed at.
      row.bg.setFillStyle(
        isActive    ? (row.hovered ? t.panel.rowHoverSelected : t.panel.highlight)
        : row.hovered ? t.panel.rowHover
        : isBankrupt  ? t.chrome.page
        : t.panel.background,
      );
      row.activeLine.setVisible(isActive);

      // Cash colour
      row.cashText.setText(`$${p.cash.toLocaleString()}`);
      row.cashText.setColor(isBankrupt ? t.panel.subtitle : t.chrome.heading);

      // Name colour
      row.nameText.setColor(isBankrupt ? t.panel.subtitle : isActive ? '#ffffff' : t.chrome.text);

      // Status tag: bankrupt > jail > active > idle
      const status = isBankrupt ? '💀 bankrupt'
                   : p.inJail   ? '🔒 jail'
                   : isActive   ? '▶ active'
                   : '';
      row.statusText.setText(status);
      row.statusText.setColor(
        isBankrupt ? t.chrome.danger :
        p.inJail   ? t.log.text.warning :
        isActive   ? t.chrome.positive : t.chrome.dim,
      );

      row.chevron.setColor(row.hovered ? t.chrome.heading : t.chrome.dim);
    });
  }

  /** Redraw in the state last given, after a hover changed one row. */
  private repaint(): void {
    if (this.shown.length) this.update(this.shown, this.activeId ?? this.shown[0].id);
  }
}
