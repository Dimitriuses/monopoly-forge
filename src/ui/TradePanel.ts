import Phaser from 'phaser';
import { theme, hex } from './Theme';
import { Surface } from './Retained';

// ─── TradePanel ───────────────────────────────────────────────────────────────
// The offer builder. Two columns, one per side: tap a deed to put it in or take
// it out, step the cash, include jail cards. The proposer builds an offer and
// sends it; the other side then sees the same table read-only with accept,
// decline and counter.
//
// Counter is not a separate mode — it hands the offer back reversed and returns
// to editing, which is why this panel only has the two states.
//
// M8c changed two things about how it draws:
//
//   * **The list is measured, not reserved.** It used to lay out eleven deed
//     rows whatever the players actually held, so a two-deed trade was mostly
//     empty space and the panel was the same size for everybody.
//   * **Which meant the buttons move**, and the playtest could no longer click
//     fixed coordinates for them. So the panel *reports* where they are —
//     `spots()` — and the harness asks, the way it already asks for a tile's
//     centre. That is the fragility CLAUDE.md warned about, gone rather than
//     documented.

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
const COL_W = 300;
/** The most deed rows shown at once; longer lists page. */
const ROWS_MAX = 11;
const ROW_H = 16;
const CENTRE = { x: 420, y: 390 };

/**
 * Where everything sits, for a list of the given length. Measured from the top
 * edge of the panel and shifted to its centre at the end, so adding a row moves
 * the buttons down by exactly one row and nothing else has to be adjusted.
 */
function metrics(rowsShown: number, paging: boolean) {
  const listTop  = 76;
  const cashRow  = listTop + rowsShown * ROW_H + (paging ? 22 : 0) + 8;
  const cardRow  = cashRow + 24;
  const summary  = cardRow + 22;
  const height   = summary + 76;
  const half     = height / 2;

  return {
    height,
    sideTop:  56      - half,
    listTop:  listTop - half,
    cashRow:  cashRow - half,
    cardRow:  cardRow - half,
    summaryY: summary - half,
    problemY: summary + 18 - half,
    buttonY:  summary + 42 - half,
  };
}

type Metrics = ReturnType<typeof metrics>;

export class TradePanel {
  private container: Phaser.GameObjects.Container;
  private surface: Surface;
  private onAction: (action: TradeAction) => void;
  /** See PropertyPanel — an unchanged view is not worth redrawing. */
  private lastRendered: string | null = null;
  /** Where the pressable things ended up, in world coordinates. */
  private spotMap = new Map<string, { x: number; y: number }>();

  constructor(scene: Phaser.Scene, onAction: (action: TradeAction) => void) {
    this.onAction  = onAction;
    this.container = scene.add.container(CENTRE.x, CENTRE.y).setDepth(46).setVisible(false);
    this.surface   = new Surface(scene, this.container);
  }

  get isOpen(): boolean { return this.container.visible; }

  /**
   * Where the panel's controls are on screen. The playtest drives a canvas with
   * no DOM, and this list is what it clicks instead of coordinates copied out of
   * this file by hand.
   */
  spots(): Record<string, { x: number; y: number }> {
    return Object.fromEntries(this.spotMap);
  }

  hide(): void {
    this.lastRendered = null;
    this.spotMap.clear();
    this.surface.clear();
    this.container.setVisible(false);
  }

  show(view: TradeView): void {
    const rendered = JSON.stringify(view);
    if (rendered === this.lastRendered && this.container.visible) return;
    this.lastRendered = rendered;

    const t = theme();
    const s = this.surface;
    const rowsShown = Math.min(
      ROWS_MAX, Math.max(1, view.left.rows.length, view.right.rows.length),
    );
    const paging = view.left.rows.length > rowsShown || view.right.rows.length > rowsShown;
    const m = metrics(rowsShown, paging);

    this.spotMap.clear();
    s.begin();

    s.graphics('frame', `${m.height}`, (g) => {
      g.fillStyle(t.panel.background, 1);
      g.fillRoundedRect(-W / 2, -m.height / 2, W, m.height, 8);
      g.lineStyle(2, t.chrome.panelBorder, 1);
      g.strokeRoundedRect(-W / 2, -m.height / 2, W, m.height, 8);
    });

    s.text('heading', 0, -m.height / 2 + 12, '🤝  TRADE', {
      fontFamily: t.font.display, fontSize: '14px',
      color: t.panel.title, fontStyle: 'bold',
    }, [0.5, 0]);

    this.press('close', W / 2 - 28, -m.height / 2 + 6, {
      label: '✕',
      style: {
        fontFamily: t.font.body, fontSize: '14px', color: t.chrome.dim,
        padding: { x: 6, y: 4 },
      },
      onPress: () => this.onAction({ kind: 'close' }),
    });

    // ── Partner switcher ──────────────────────────────────────────────────────
    if (view.mode === 'edit' && view.partners.length > 1) {
      s.text('partnerLabel', -W / 2 + 16, -m.height / 2 + 34, 'Trade with', {
        fontFamily: t.font.display, fontSize: '10px', color: t.panel.subtitle,
      });
      view.partners.forEach((partner, i) => {
        const fill = partner.active ? t.panel.button.hover : hex(t.panel.background);
        this.press(`partner:${partner.id}`, -W / 2 + 82 + i * 92, -m.height / 2 + 30, {
          label: partner.name,
          style: {
            fontFamily: t.font.display, fontSize: '11px',
            color: partner.active ? t.panel.button.text : t.panel.dim,
            backgroundColor: fill, padding: { x: 8, y: 4 },
            fixedWidth: 84, align: 'center',
          },
          hover: { on: t.panel.button.hover, off: fill },
          onPress: () => this.onAction({ kind: 'partner', playerId: partner.id }),
        });
      });
    }

    // ── The two sides ─────────────────────────────────────────────────────────
    this.buildSide(view.left,  -W / 2 + 16, 'left',  view.mode, m, rowsShown);
    this.buildSide(view.right,  16,         'right', view.mode, m, rowsShown);

    s.graphics('divider', `${m.cardRow}`, (g) => {
      g.lineStyle(1, t.panel.divider, 1);
      g.lineBetween(0, m.sideTop, 0, m.cardRow + 14);
    });

    // ── Summary and verdict ───────────────────────────────────────────────────
    s.text('summary', 0, m.summaryY, view.summary, {
      fontFamily: t.font.display, fontSize: '11px', color: t.panel.body,
      wordWrap: { width: W - 40 }, align: 'center',
    }, [0.5, 0]);

    if (view.problem) {
      s.text('problem', 0, m.problemY, view.problem, {
        fontFamily: t.font.display, fontSize: '10px', color: t.log.text.danger,
        wordWrap: { width: W - 40 }, align: 'center',
      }, [0.5, 0]);
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    if (view.mode === 'edit') {
      this.actionButton('propose', '📨  PROPOSE', 0, m.buttonY, !view.problem,
        t.panel.button.on, t.panel.button.hover, { kind: 'propose' });
    } else {
      this.actionButton('accept', '✅  ACCEPT', -110, m.buttonY, !view.problem,
        t.panel.button.on, t.chrome.positive, { kind: 'accept' });
      this.actionButton('counter', '↩  COUNTER', 0, m.buttonY, true,
        t.chrome.button.fill, t.chrome.button.hover, { kind: 'counter' });
      this.actionButton('decline', '❌  DECLINE', 110, m.buttonY, true,
        t.chrome.primary.fill, t.chrome.primary.hover, { kind: 'decline' });
    }

    s.end();
    this.container.setVisible(true);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private buildSide(
    side: TradeSideView, x: number,
    which: 'left' | 'right', mode: 'edit' | 'review',
    m: Metrics, rowsShown: number,
  ): void {
    const t = theme();
    const s = this.surface;
    const editable = mode === 'edit';
    const key = (name: string) => `${which}:${name}`;

    s.circle(key('dot'), x + 7, m.sideTop + 7, 6, side.color);
    s.text(key('name'), x + 20, m.sideTop, `${side.name} offers`, {
      fontFamily: t.font.display, fontSize: '12px',
      color: t.chrome.text, fontStyle: 'bold',
    });
    s.text(key('cash'), x + COL_W - 8, m.sideTop + 1, `$${side.cash.toLocaleString()} in hand`, {
      fontFamily: t.font.display, fontSize: '10px', color: t.panel.subtitle,
    }, [1, 0]);

    // ── Deeds ─────────────────────────────────────────────────────────────────
    const page = side.rows.slice(side.scroll, side.scroll + rowsShown);

    if (side.rows.length === 0) {
      s.text(key('empty'), x + 6, m.listTop + 4, 'No deeds to offer.', {
        fontFamily: t.font.display, fontSize: '10px', color: t.panel.subtitle,
      });
    }

    page.forEach((row, i) => {
      const ry = m.listTop + i * ROW_H;
      const fill = row.selected ? t.panel.highlight : t.log.background;
      const bg = s.rectangle(key(`row:${i}`), x, ry, COL_W - 4, ROW_H - 2, fill);

      if (row.color !== null) {
        s.rectangle(key(`swatch:${i}`), x + 3, ry + 2, 4, ROW_H - 6, row.color);
      }
      s.text(key(`label:${i}`), x + 12, ry + 2, row.name, {
        fontFamily: t.font.display, fontSize: '10px',
        color: row.blocked ? t.panel.subtitle
             : row.selected ? t.panel.button.text : t.panel.body,
      });
      s.text(key(`mark:${i}`), x + COL_W - 12, ry + 2,
        row.blocked ? '🏠' : row.selected ? '✓' : '', {
          fontFamily: t.font.body, fontSize: '9px',
          color: row.blocked ? t.panel.dim : t.chrome.positive,
        }, [1, 0]);

      // The first row of each side is what the playtest clicks to build an offer.
      if (i === 0) this.mark(key('row1'), x + COL_W / 2, ry + ROW_H / 2);

      // A rectangle is not a `Surface.button`, so its listeners are rebound here
      // — but the object itself is still the retained one, which is what stops
      // the list flickering as rows are selected.
      bg.off('pointerover');
      bg.off('pointerout');
      bg.off('pointerdown');
      if (editable && !row.blocked) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setFillStyle(row.selected ? t.panel.rowHoverSelected : t.panel.rowHover));
        bg.on('pointerout',  () => bg.setFillStyle(fill));
        bg.on('pointerdown', () => this.onAction({ kind: 'toggleTile', side: which, tileId: row.tileId }));
      } else {
        bg.disableInteractive();
      }
    });

    // Paging only appears when the list is longer than the window.
    if (side.rows.length > rowsShown) {
      const pagerY = m.listTop + rowsShown * ROW_H + 2;
      this.stepButton(key('pageUp'), '▲', x + 20, pagerY + 8, editable && side.scroll > 0,
        { kind: 'scroll', side: which, delta: -rowsShown });
      this.stepButton(key('pageDown'), '▼', x + 60, pagerY + 8,
        editable && side.scroll + rowsShown < side.rows.length,
        { kind: 'scroll', side: which, delta: rowsShown });
      s.text(key('pageCount'), x + 88, pagerY + 2,
        `${side.scroll + 1}–${Math.min(side.scroll + rowsShown, side.rows.length)} of ${side.rows.length}`, {
          fontFamily: t.font.display, fontSize: '9px', color: t.panel.subtitle,
        });
    }

    // ── Cash and jail cards ───────────────────────────────────────────────────
    s.text(key('cashLabel'), x + 4, m.cashRow + 3, 'Cash', {
      fontFamily: t.font.display, fontSize: '10px', color: t.panel.subtitle,
    });
    s.text(key('cashValue'), x + 96, m.cashRow + 1, `$${side.offeredCash}`, {
      fontFamily: t.font.display, fontSize: '12px',
      color: side.offeredCash > 0 ? t.panel.accent : t.panel.subtitle,
    }, [0.5, 0]);

    const steps: Array<[string, number]> = [['−50', -50], ['−10', -10], ['+10', 10], ['+50', 50]];
    steps.forEach(([label, delta], i) => {
      const enabled = editable
        && (delta > 0 ? side.offeredCash + delta <= side.cash : side.offeredCash > 0);
      this.stepButton(key(`cash:${delta}`), label, x + 148 + i * 38, m.cashRow + 8, enabled,
        { kind: 'cash', side: which, delta });
    });

    if (side.jailCards > 0 || side.offeredJailCards > 0) {
      s.text(key('cards'), x + 4, m.cardRow + 3,
        `🃏 Jail cards  ${side.offeredJailCards} of ${side.jailCards}`, {
          fontFamily: t.font.display, fontSize: '10px',
          color: side.offeredJailCards > 0 ? t.panel.accent : t.panel.subtitle,
        });
      this.stepButton(key('cardMinus'), '−', x + 148, m.cardRow + 8,
        editable && side.offeredJailCards > 0, { kind: 'jailCards', side: which, delta: -1 });
      this.stepButton(key('cardPlus'), '+', x + 186, m.cardRow + 8,
        editable && side.offeredJailCards < side.jailCards,
        { kind: 'jailCards', side: which, delta: 1 });
    }
  }

  /** A small stepper, the shape used for paging, cash and jail cards. */
  private stepButton(
    key: string, label: string, x: number, y: number, enabled: boolean, action: TradeAction,
  ): void {
    const t = theme();
    const fill = enabled ? hex(t.panel.background) : t.panel.button.off;
    this.press(key, x, y, {
      label,
      style: {
        fontFamily: t.font.display, fontSize: '11px',
        color: enabled ? t.panel.button.text : t.panel.button.textOff,
        backgroundColor: fill, padding: { x: 6, y: 5 },
        fixedWidth: 34, align: 'center',
      },
      hover: enabled ? { on: t.chrome.button.hover, off: fill } : undefined,
      origin: [0.5, 0.5],
      onPress: () => { if (enabled) this.onAction(action); },
    });
  }

  private actionButton(
    key: string, label: string, x: number, y: number, enabled: boolean,
    fill: string, hover: string, action: TradeAction,
  ): void {
    const t = theme();
    const bg = enabled ? fill : t.panel.button.off;
    this.press(key, x, y, {
      label,
      style: {
        fontFamily: t.font.display, fontSize: '11px',
        color: enabled ? t.panel.button.text : t.panel.button.textOff,
        backgroundColor: bg, padding: { x: 6, y: 5 },
        fixedWidth: 100, align: 'center',
      },
      hover: enabled ? { on: hover, off: bg } : undefined,
      origin: [0.5, 0.5],
      onPress: () => { if (enabled) this.onAction(action); },
    });
  }

  /** Draw a button and record where it landed. */
  private press(
    key: string, x: number, y: number,
    spec: Parameters<Surface['button']>[3],
  ): void {
    this.surface.button(key, x, y, spec);
    const origin = spec.origin ?? [0, 0];
    // Only a centred button has a click point at its anchor; the corner-anchored
    // ones are small enough that a few pixels in is still inside them.
    this.mark(key, x + (origin[0] === 0.5 ? 0 : 10), y + (origin[1] === 0.5 ? 0 : 8));
  }

  private mark(key: string, localX: number, localY: number): void {
    this.spotMap.set(key, { x: CENTRE.x + localX, y: CENTRE.y + localY });
  }
}
