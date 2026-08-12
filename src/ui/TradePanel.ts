import Phaser from 'phaser';

// ─── TradePanel ───────────────────────────────────────────────────────────────
// The offer builder. Two columns, one per side: tap a deed to put it in or take
// it out, step the cash, include jail cards. The proposer builds an offer and
// sends it; the other side then sees the same table read-only with accept,
// decline and counter.
//
// Counter is not a separate mode — it hands the offer back reversed and returns
// to editing, which is why this panel only has the two states.

export interface TradeRow {
  tileId: number;
  name: string;
  /** Colour-group swatch, or null for railroads and utilities. */
  color: number | null;
  selected: boolean;
  /** Buildings in the group block a trade; the row says so instead of hiding. */
  blocked: boolean;
}

export interface TradeSideView {
  playerId: string;
  name: string;
  color: number;
  cash: number;
  offeredCash: number;
  jailCards: number;
  offeredJailCards: number;
  rows: TradeRow[];
  /** Row index the list starts at, for paging. */
  scroll: number;
}

export interface TradeView {
  /** 'edit' while the proposer builds it, 'review' once it has been sent. */
  mode: 'edit' | 'review';
  left: TradeSideView;
  right: TradeSideView;
  /** Everyone who could be traded with, for the partner switcher. */
  partners: Array<{ id: string; name: string; active: boolean }>;
  summary: string;
  /** Empty when the offer is legal, otherwise why it cannot be sent. */
  problem: string;
}

export type TradeAction =
  | { kind: 'toggleTile';  side: 'left' | 'right'; tileId: number }
  | { kind: 'cash';        side: 'left' | 'right'; delta: number }
  | { kind: 'jailCards';   side: 'left' | 'right'; delta: number }
  | { kind: 'scroll';      side: 'left' | 'right'; delta: number }
  | { kind: 'partner';     playerId: string }
  | { kind: 'propose' }
  | { kind: 'accept' }
  | { kind: 'decline' }
  | { kind: 'counter' }
  | { kind: 'close' };

const W = 660;
const H = 404;
const COL_W = 300;
const ROWS_VISIBLE = 11;
const ROW_H = 16;

// The layout is fixed rather than measured: the deed list always reserves
// ROWS_VISIBLE rows so both columns line up, and everything below hangs off the
// bottom of that list. Change ROWS_VISIBLE and H follows from these.
const SIDE_TOP   = -H / 2 + 56;                              // side headers
const LIST_TOP   = SIDE_TOP + 20;
const CASH_ROW   = LIST_TOP + ROWS_VISIBLE * ROW_H + 26;
const CARD_ROW   = CASH_ROW + 24;
const SUMMARY_Y  = CARD_ROW + 22;
const PROBLEM_Y  = SUMMARY_Y + 18;
const BUTTON_Y   = SUMMARY_Y + 42;

export class TradePanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private onAction: (action: TradeAction) => void;

  constructor(scene: Phaser.Scene, onAction: (action: TradeAction) => void) {
    this.scene     = scene;
    this.onAction  = onAction;
    this.container = scene.add.container(420, 390).setDepth(46).setVisible(false);
  }

  get isOpen(): boolean { return this.container.visible; }

  hide(): void { this.container.setVisible(false); }

  show(view: TradeView): void {
    this.container.removeAll(true);
    const parts: Phaser.GameObjects.GameObject[] = [];

    const frame = this.scene.add.graphics();
    frame.fillStyle(0x0b1220, 1);
    frame.fillRoundedRect(-W / 2, -H / 2, W, H, 8);
    frame.lineStyle(2, 0x4466aa, 1);
    frame.strokeRoundedRect(-W / 2, -H / 2, W, H, 8);
    parts.push(frame);

    parts.push(this.scene.add.text(0, -H / 2 + 12, '🤝  TRADE', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#f0c040', fontStyle: 'bold',
    }).setOrigin(0.5, 0));

    const close = this.scene.add.text(W / 2 - 20, -H / 2 + 10, '✕', {
      fontFamily: 'Arial', fontSize: '14px', color: '#7788aa',
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#ddeeff'));
    close.on('pointerout',  () => close.setColor('#7788aa'));
    close.on('pointerdown', () => this.onAction({ kind: 'close' }));
    parts.push(close);

    // ── Partner switcher ──────────────────────────────────────────────────────
    if (view.mode === 'edit' && view.partners.length > 1) {
      parts.push(this.scene.add.text(-W / 2 + 16, -H / 2 + 34, 'Trade with', {
        fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
      }));
      view.partners.forEach((partner, i) => {
        const chip = this.scene.add.text(-W / 2 + 82 + i * 92, -H / 2 + 30, partner.name, {
          fontFamily: 'Georgia, serif', fontSize: '11px',
          color: partner.active ? '#ffffff' : '#8899aa',
          backgroundColor: partner.active ? '#2a6b9b' : '#1a2640',
          padding: { x: 8, y: 4 }, fixedWidth: 84, align: 'center',
        }).setInteractive({ useHandCursor: true });
        chip.on('pointerdown', () => this.onAction({ kind: 'partner', playerId: partner.id }));
        parts.push(chip);
      });
    }

    // ── The two sides ─────────────────────────────────────────────────────────
    parts.push(...this.buildSide(view.left,  -W / 2 + 16, 'left',  view.mode));
    parts.push(...this.buildSide(view.right,  16,         'right', view.mode));

    const divider = this.scene.add.graphics();
    divider.lineStyle(1, 0x2a3a55, 1);
    divider.lineBetween(0, SIDE_TOP, 0, CARD_ROW + 14);
    parts.push(divider);

    // ── Summary and verdict ───────────────────────────────────────────────────
    parts.push(this.scene.add.text(0, SUMMARY_Y, view.summary, {
      fontFamily: 'Georgia, serif', fontSize: '11px', color: '#aabbcc',
      wordWrap: { width: W - 40 }, align: 'center',
    }).setOrigin(0.5, 0));

    if (view.problem) {
      parts.push(this.scene.add.text(0, PROBLEM_Y, view.problem, {
        fontFamily: 'Georgia, serif', fontSize: '10px', color: '#e08080',
        wordWrap: { width: W - 40 }, align: 'center',
      }).setOrigin(0.5, 0));
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    const y = BUTTON_Y;
    if (view.mode === 'edit') {
      parts.push(this.button('📨  PROPOSE', 0, y, !view.problem, '#1a4a6b', '#2a6b9b',
        () => this.onAction({ kind: 'propose' })));
    } else {
      parts.push(this.button('✅  ACCEPT', -110, y, !view.problem, '#1a6b35', '#27ae60',
        () => this.onAction({ kind: 'accept' })));
      parts.push(this.button('↩  COUNTER', 0, y, true, '#4a4a1a', '#7d6608',
        () => this.onAction({ kind: 'counter' })));
      parts.push(this.button('❌  DECLINE', 110, y, true, '#6b1e1e', '#922b21',
        () => this.onAction({ kind: 'decline' })));
    }

    this.container.add(parts);
    this.container.setVisible(true);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private buildSide(
    side: TradeSideView, x: number,
    which: 'left' | 'right', mode: 'edit' | 'review',
  ): Phaser.GameObjects.GameObject[] {
    const parts: Phaser.GameObjects.GameObject[] = [];
    const editable = mode === 'edit';
    const y = SIDE_TOP;

    parts.push(this.scene.add.circle(x + 7, y + 7, 6, side.color).setStrokeStyle(1, 0xffffff));
    parts.push(this.scene.add.text(x + 20, y, `${side.name} offers`, {
      fontFamily: 'Georgia, serif', fontSize: '12px', color: '#ddeeff', fontStyle: 'bold',
    }));
    parts.push(this.scene.add.text(x + COL_W - 8, y + 1, `$${side.cash.toLocaleString()} in hand`, {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
    }).setOrigin(1, 0));

    // ── Deeds ─────────────────────────────────────────────────────────────────
    const listY = LIST_TOP;
    const page  = side.rows.slice(side.scroll, side.scroll + ROWS_VISIBLE);

    if (side.rows.length === 0) {
      parts.push(this.scene.add.text(x + 6, listY + 4, 'No deeds to offer.', {
        fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
      }));
    }

    page.forEach((row, i) => {
      const ry = listY + i * ROW_H;
      const bg = this.scene.add.rectangle(x, ry, COL_W - 4, ROW_H - 2,
        row.selected ? 0x1e3454 : 0x121c30).setOrigin(0, 0);
      parts.push(bg);

      if (row.color !== null) {
        parts.push(this.scene.add.rectangle(x + 3, ry + 2, 4, ROW_H - 6, row.color).setOrigin(0, 0));
      }

      const label = this.scene.add.text(x + 12, ry + 2, row.name, {
        fontFamily: 'Georgia, serif', fontSize: '10px',
        color: row.blocked ? '#6b5a5a' : row.selected ? '#ffffff' : '#9fb0c4',
      });
      parts.push(label);

      const mark = this.scene.add.text(x + COL_W - 12, ry + 2,
        row.blocked ? '🏠' : row.selected ? '✓' : '', {
          fontFamily: 'Arial', fontSize: '9px', color: row.blocked ? '#8b7355' : '#88ff88',
        }).setOrigin(1, 0);
      parts.push(mark);

      if (editable && !row.blocked) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setFillStyle(row.selected ? 0x2a4a74 : 0x1a2640));
        bg.on('pointerout',  () => bg.setFillStyle(row.selected ? 0x1e3454 : 0x121c30));
        bg.on('pointerdown', () => this.onAction({ kind: 'toggleTile', side: which, tileId: row.tileId }));
      }
    });

    // Paging only appears when the list is longer than the window.
    if (side.rows.length > ROWS_VISIBLE) {
      const pagerY = listY + ROWS_VISIBLE * ROW_H + 2;
      parts.push(this.button('▲', x + 20, pagerY + 8, editable && side.scroll > 0,
        '#1a2640', '#2a3a55', () => this.onAction({ kind: 'scroll', side: which, delta: -ROWS_VISIBLE }), 34));
      parts.push(this.button('▼', x + 60, pagerY + 8,
        editable && side.scroll + ROWS_VISIBLE < side.rows.length,
        '#1a2640', '#2a3a55', () => this.onAction({ kind: 'scroll', side: which, delta: ROWS_VISIBLE }), 34));
      parts.push(this.scene.add.text(x + 88, pagerY + 2,
        `${side.scroll + 1}–${Math.min(side.scroll + ROWS_VISIBLE, side.rows.length)} of ${side.rows.length}`, {
          fontFamily: 'Georgia, serif', fontSize: '9px', color: '#55667a',
        }));
    }

    // ── Cash and jail cards ───────────────────────────────────────────────────
    const footY = CASH_ROW;
    parts.push(this.scene.add.text(x + 4, footY + 3, 'Cash', {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
    }));
    parts.push(this.scene.add.text(x + 96, footY + 1, `$${side.offeredCash}`, {
      fontFamily: 'Georgia, serif', fontSize: '12px',
      color: side.offeredCash > 0 ? '#f0c040' : '#55667a',
    }).setOrigin(0.5, 0));

    const steps: Array<[string, number]> = [['−50', -50], ['−10', -10], ['+10', 10], ['+50', 50]];
    steps.forEach(([label, delta], i) => {
      const enabled = editable
        && (delta > 0 ? side.offeredCash + delta <= side.cash : side.offeredCash > 0);
      parts.push(this.button(label, x + 148 + i * 38, footY + 8, enabled, '#1a2640', '#2a3a55',
        () => this.onAction({ kind: 'cash', side: which, delta }), 34));
    });

    if (side.jailCards > 0 || side.offeredJailCards > 0) {
      const cardY = CARD_ROW;
      parts.push(this.scene.add.text(x + 4, cardY + 3,
        `🃏 Jail cards  ${side.offeredJailCards} of ${side.jailCards}`, {
          fontFamily: 'Georgia, serif', fontSize: '10px',
          color: side.offeredJailCards > 0 ? '#f0c040' : '#55667a',
        }));
      parts.push(this.button('−', x + 148, cardY + 8, editable && side.offeredJailCards > 0,
        '#1a2640', '#2a3a55', () => this.onAction({ kind: 'jailCards', side: which, delta: -1 }), 34));
      parts.push(this.button('+', x + 186, cardY + 8,
        editable && side.offeredJailCards < side.jailCards,
        '#1a2640', '#2a3a55', () => this.onAction({ kind: 'jailCards', side: which, delta: 1 }), 34));
    }

    return parts;
  }

  private button(
    label: string, x: number, y: number, enabled: boolean,
    bg: string, hover: string, onClick: () => void, width = 100,
  ): Phaser.GameObjects.Text {
    const btn = this.scene.add.text(x, y, label, {
      fontFamily: 'Georgia, serif', fontSize: '11px',
      color: enabled ? '#ffffff' : '#4a5468',
      backgroundColor: enabled ? bg : '#161d2c',
      padding: { x: 6, y: 5 }, fixedWidth: width, align: 'center',
    }).setOrigin(0.5);

    if (enabled) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setStyle({ backgroundColor: hover }));
      btn.on('pointerout',  () => btn.setStyle({ backgroundColor: bg }));
      btn.on('pointerdown', onClick);
    }
    return btn;
  }
}
