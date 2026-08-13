import Phaser from 'phaser';
import { theme } from './Theme';
import { Surface } from './Retained';

// ─── PropertyPanel ────────────────────────────────────────────────────────────
// The tile inspector, living in the column between the board and the HUD.
// It draws a view model and reports button presses; every rule decision — which
// actions exist, whether they are legal and why not — is made in GameScene
// against BuildRules, so this class stays a renderer.
//
// It draws onto a `Surface` (M8c): every element has a name, and a render writes
// to whatever is already there rather than destroying the panel and building a
// new one. Its colours come from `theme()` for the same reason — the panel is
// where the rest of the game's palette shows up next to a tile's colour group.

export type PanelActionKey =
  | 'buildHouse' | 'buildHotel'
  | 'sellHouse'  | 'sellHotel'
  | 'mortgage'   | 'unmortgage';

export interface PanelAction {
  key: PanelActionKey;
  label: string;
  enabled: boolean;
  /** Shown when the button is pressed while disabled. */
  reason: string;
}

export interface RentRow {
  label: string;
  value: string;
  /** The tier the tile currently charges — highlighted. */
  active: boolean;
}

export interface PropertyView {
  tileId: number;
  name: string;
  subtitle: string;
  groupColor: number | null;
  ownerLabel: string;
  ownerColor: number | null;
  facts: string[];
  rentRows: RentRow[];
  status: string;
  actions: PanelAction[];
  /** Explains an empty action list, e.g. "Nobody owns this yet." */
  note: string;
}

const X = 770;
const W = 275;
const Y = 40;
const H = 440;

export class PropertyPanel {
  private container: Phaser.GameObjects.Container;
  private surface: Surface;
  private onAction: (key: PanelActionKey) => void;
  private onRefused: (reason: string) => void;
  private currentId: number | null = null;
  /** The view last drawn, so an unchanged one costs nothing to "re-render". */
  private lastRendered: string | null = null;

  constructor(
    scene: Phaser.Scene,
    onAction: (key: PanelActionKey) => void,
    onRefused: (reason: string) => void,
  ) {
    this.onAction  = onAction;
    this.onRefused = onRefused;
    this.container = scene.add.container(X, Y).setDepth(30).setVisible(false);
    this.surface   = new Surface(scene, this.container);
  }

  get isOpen(): boolean { return this.container.visible; }
  get tileId(): number | null { return this.currentId; }

  hide(): void {
    this.currentId = null;
    this.lastRendered = null;
    this.surface.clear();
    this.container.setVisible(false);
  }

  show(view: PropertyView): void {
    // GameScene refreshes this panel on every turn change, but since the buttons
    // belong to the tile's *owner* rather than to whoever is rolling, the view is
    // usually identical from one turn to the next — so the cheapest render is
    // still no render at all. What changed in M8c is the case below it: a view
    // that *has* changed writes to the elements already on screen.
    const rendered = JSON.stringify(view);
    if (rendered === this.lastRendered && this.container.visible) return;
    this.lastRendered = rendered;
    this.currentId = view.tileId;

    const t = theme();
    const s = this.surface;
    s.begin();

    s.graphics('frame', `${view.groupColor}`, (g) => {
      g.fillStyle(t.panel.background, t.panel.backgroundAlpha);
      g.fillRoundedRect(0, 0, W, H, 6);
      g.lineStyle(1, t.panel.border, 1);
      g.strokeRoundedRect(0, 0, W, H, 6);
      if (view.groupColor !== null) {
        g.fillStyle(view.groupColor, 1);
        g.fillRect(1, 1, W - 2, 8);
      }
    });

    s.text('name', 12, 18, view.name, {
      fontFamily: t.font.display, fontSize: '16px', color: t.panel.title,
      fontStyle: 'bold', wordWrap: { width: W - 46 },
    });
    s.text('subtitle', 12, 40, view.subtitle, {
      fontFamily: t.font.display, fontSize: '10px', color: t.panel.subtitle,
    });
    s.button('close', W - 28, 10, {
      label: '✕',
      style: {
        fontFamily: t.font.body, fontSize: '14px', color: t.panel.dim,
        padding: { x: 6, y: 4 },
      },
      onPress: () => this.hide(),
    });

    // ── Owner ─────────────────────────────────────────────────────────────────
    let y = 62;
    if (view.ownerColor !== null) s.circle('ownerDot', 19, y + 7, 6, view.ownerColor);
    s.text('owner', view.ownerColor !== null ? 32 : 12, y, view.ownerLabel, {
      fontFamily: t.font.display, fontSize: '12px', color: t.panel.body,
    });
    y += 20;

    if (view.status) {
      s.text('status', 12, y, view.status, {
        fontFamily: t.font.display, fontSize: '11px', color: t.panel.accent,
      });
      y += 18;
    }

    // ── Facts ─────────────────────────────────────────────────────────────────
    y = this.divider('facts', y + 4);
    view.facts.forEach((fact, i) => {
      s.text(`fact:${i}`, 12, y, fact, {
        fontFamily: t.font.display, fontSize: '11px', color: t.panel.body,
      });
      y += 16;
    });

    // ── Rent ladder ───────────────────────────────────────────────────────────
    if (view.rentRows.length) {
      y = this.divider('rent', y + 4);
      s.text('rentHeading', 12, y, 'RENT', {
        fontFamily: t.font.display, fontSize: '9px', color: t.panel.subtitle,
      });
      y += 14;

      view.rentRows.forEach((row, i) => {
        if (row.active) s.rectangle(`rentBg:${i}`, 8, y - 2, W - 16, 15, t.panel.highlight);
        s.text(`rentLabel:${i}`, 14, y, row.label, {
          fontFamily: t.font.display, fontSize: '11px',
          color: row.active ? '#ffffff' : t.panel.dim,
        });
        s.text(`rentValue:${i}`, W - 14, y, row.value, {
          fontFamily: t.font.display, fontSize: '11px',
          color: row.active ? t.panel.accent : t.panel.dim,
        }, [1, 0]);
        y += 16;
      });
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    y = this.divider('actions', y + 6);
    if (view.actions.length === 0) {
      s.text('note', 12, y, view.note, {
        fontFamily: t.font.display, fontSize: '10px', color: t.panel.subtitle,
        wordWrap: { width: W - 24 },
      });
    } else {
      view.actions.forEach((action, i) => {
        this.actionButton(action, 12 + (i % 2) * 132, y + Math.floor(i / 2) * 30);
      });
    }

    s.end();
    this.container.setVisible(true);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private divider(name: string, y: number): number {
    this.surface.graphics(`divider:${name}`, `${y}`, (g) => {
      g.lineStyle(1, theme().panel.divider, 1);
      g.lineBetween(8, y, W - 8, y);
    });
    return y + 8;
  }

  private actionButton(action: PanelAction, x: number, y: number): void {
    const t = theme();
    const off = action.enabled ? t.panel.button.on : t.panel.button.off;
    this.surface.button(`action:${action.key}`, x, y, {
      label: action.label,
      style: {
        fontFamily: t.font.display, fontSize: '11px',
        color: action.enabled ? t.panel.button.text : t.panel.button.textOff,
        backgroundColor: off, padding: { x: 8, y: 6 },
        fixedWidth: 124, align: 'center',
      },
      hover: { on: action.enabled ? t.panel.button.hover : off, off },
      // A disabled button still answers — it says why, which is the point of
      // having the rule checks return a reason.
      onPress: () => {
        if (action.enabled) this.onAction(action.key);
        else                this.onRefused(action.reason);
      },
    });
  }
}
