import Phaser from 'phaser';

// ─── PropertyPanel ────────────────────────────────────────────────────────────
// The tile inspector, living in the column between the board and the HUD.
// It draws a view model and reports button presses; every rule decision — which
// actions exist, whether they are legal and why not — is made in GameScene
// against BuildRules, so this class stays a renderer.

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
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private onAction: (key: PanelActionKey) => void;
  private onRefused: (reason: string) => void;
  private currentId: number | null = null;

  constructor(
    scene: Phaser.Scene,
    onAction: (key: PanelActionKey) => void,
    onRefused: (reason: string) => void,
  ) {
    this.scene     = scene;
    this.onAction  = onAction;
    this.onRefused = onRefused;
    this.container = scene.add.container(X, Y).setDepth(30).setVisible(false);
  }

  get isOpen(): boolean { return this.container.visible; }
  get tileId(): number | null { return this.currentId; }

  hide(): void {
    this.currentId = null;
    this.container.setVisible(false);
  }

  show(view: PropertyView): void {
    this.currentId = view.tileId;
    this.container.removeAll(true);

    const parts: Phaser.GameObjects.GameObject[] = [];
    const frame = this.scene.add.graphics();
    frame.fillStyle(0x0b1220, 0.96);
    frame.fillRoundedRect(0, 0, W, H, 6);
    frame.lineStyle(1, 0x2a3a55, 1);
    frame.strokeRoundedRect(0, 0, W, H, 6);
    if (view.groupColor !== null) {
      frame.fillStyle(view.groupColor, 1);
      frame.fillRect(1, 1, W - 2, 8);
    }
    parts.push(frame);

    parts.push(this.scene.add.text(12, 18, view.name, {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#f0c040',
      fontStyle: 'bold', wordWrap: { width: W - 46 },
    }));
    parts.push(this.scene.add.text(12, 40, view.subtitle, {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
    }));

    const close = this.scene.add.text(W - 20, 16, '✕', {
      fontFamily: 'Arial', fontSize: '14px', color: '#7788aa',
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setColor('#ddeeff'));
    close.on('pointerout',  () => close.setColor('#7788aa'));
    close.on('pointerdown', () => this.hide());
    parts.push(close);

    // ── Owner ─────────────────────────────────────────────────────────────────
    let y = 62;
    if (view.ownerColor !== null) {
      parts.push(this.scene.add.circle(19, y + 7, 6, view.ownerColor).setStrokeStyle(1, 0xffffff));
    }
    parts.push(this.scene.add.text(view.ownerColor !== null ? 32 : 12, y, view.ownerLabel, {
      fontFamily: 'Georgia, serif', fontSize: '12px', color: '#ddeeff',
    }));
    y += 20;

    if (view.status) {
      parts.push(this.scene.add.text(12, y, view.status, {
        fontFamily: 'Georgia, serif', fontSize: '11px', color: '#f0c040',
      }));
      y += 18;
    }

    // ── Facts ─────────────────────────────────────────────────────────────────
    y = this.divider(parts, y + 4);
    view.facts.forEach((fact) => {
      parts.push(this.scene.add.text(12, y, fact, {
        fontFamily: 'Georgia, serif', fontSize: '11px', color: '#aabbcc',
      }));
      y += 16;
    });

    // ── Rent ladder ───────────────────────────────────────────────────────────
    if (view.rentRows.length) {
      y = this.divider(parts, y + 4);
      parts.push(this.scene.add.text(12, y, 'RENT', {
        fontFamily: 'Georgia, serif', fontSize: '9px', color: '#2a3a55',
      }));
      y += 14;

      view.rentRows.forEach((row) => {
        const color = row.active ? '#ffffff' : '#8899aa';
        if (row.active) {
          parts.push(this.scene.add.rectangle(8, y - 2, W - 16, 15, 0x1e3454).setOrigin(0, 0));
        }
        parts.push(this.scene.add.text(14, y, row.label, {
          fontFamily: 'Georgia, serif', fontSize: '11px', color,
        }));
        parts.push(this.scene.add.text(W - 14, y, row.value, {
          fontFamily: 'Georgia, serif', fontSize: '11px',
          color: row.active ? '#f0c040' : '#8899aa',
        }).setOrigin(1, 0));
        y += 16;
      });
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    y = this.divider(parts, y + 6);
    if (view.actions.length === 0) {
      parts.push(this.scene.add.text(12, y, view.note, {
        fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
        wordWrap: { width: W - 24 },
      }));
    } else {
      view.actions.forEach((action, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        parts.push(this.actionButton(action, 12 + col * 132, y + row * 30));
      });
    }

    this.container.add(parts);
    this.container.setVisible(true);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private divider(parts: Phaser.GameObjects.GameObject[], y: number): number {
    const line = this.scene.add.graphics();
    line.lineStyle(1, 0x2a3a55, 1);
    line.lineBetween(8, y, W - 8, y);
    parts.push(line);
    return y + 8;
  }

  private actionButton(action: PanelAction, x: number, y: number): Phaser.GameObjects.Text {
    const bg = action.enabled ? '#1a4a6b' : '#232a36';
    const btn = this.scene.add.text(x, y, action.label, {
      fontFamily: 'Georgia, serif', fontSize: '11px',
      color: action.enabled ? '#ffffff' : '#5a6478',
      backgroundColor: bg, padding: { x: 8, y: 6 },
      fixedWidth: 124, align: 'center',
    }).setInteractive({ useHandCursor: true });

    // A disabled button still answers — it says why, which is the point of
    // having the rule checks return a reason.
    btn.on('pointerover', () => btn.setStyle({ backgroundColor: action.enabled ? '#2a6b9b' : '#2c3542' }));
    btn.on('pointerout',  () => btn.setStyle({ backgroundColor: bg }));
    btn.on('pointerdown', () => {
      if (action.enabled) this.onAction(action.key);
      else                this.onRefused(action.reason);
    });
    return btn;
  }
}
