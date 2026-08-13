import Phaser from 'phaser';

// ─── Retained ─────────────────────────────────────────────────────────────────
// A panel that has changed, updated rather than rebuilt.
//
// The three panels each drew themselves with `container.removeAll(true)` and a
// hundred fresh objects. M6 stopped that happening when the view was *identical*
// — which is the common case, `refreshPanel()` on every turn change — but a view
// that had genuinely changed still destroyed every child and made a new one. It
// dropped the hover state under the cursor, it made every button a new object
// with new listeners, and it is the same problem as drawing a theme: hold a
// reference to what is on screen and write to it.
//
// A `Surface` is that reference, keyed by a name the panel chooses. Each render
// runs between `begin()` and `end()`; anything not asked for in between is what
// has genuinely gone, and only that is destroyed.
//
// Two things it deliberately does *not* do:
//
//   * **No layout.** It does not know what a row is. Panels still place their
//     own children, because "where does this go" is the panel's design and
//     inventing a layout language here would be a second one to learn.
//   * **No re-registering listeners.** A button's handler closes over the view
//     it was drawn for, and re-adding it every render is how listener leaks
//     start. The object is created once and its handler lives in a slot this
//     class rewrites, so `pointerover` fires on the same object all game.

type Style = Phaser.Types.GameObjects.Text.TextStyle;

interface Slot {
  object: Phaser.GameObjects.GameObject;
  /** What it was last drawn as. Equal means nothing to do. */
  signature: string;
}

export interface ButtonSpec {
  label: string;
  style: Style;
  /** Background swapped on hover; omitted leaves the button inert-looking. */
  hover?: { on: string; off: string };
  origin?: [number, number];
  onPress(): void;
}

export class Surface {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private slots = new Map<string, Slot>();
  private touched = new Set<string>();
  /** A button's current handler, rewritten each render, called by one listener. */
  private presses = new Map<string, () => void>();

  constructor(scene: Phaser.Scene, container: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.container = container;
  }

  /** Start a render pass. Everything drawn after this counts as still present. */
  begin(): void {
    this.touched.clear();
  }

  /** Finish it, destroying whatever this pass did not ask for. */
  end(): void {
    for (const [key, slot] of [...this.slots]) {
      if (this.touched.has(key)) continue;
      slot.object.destroy();
      this.slots.delete(key);
      this.presses.delete(key);
    }
  }

  /** Throw everything away — for a panel being closed rather than redrawn. */
  clear(): void {
    for (const slot of this.slots.values()) slot.object.destroy();
    this.slots.clear();
    this.presses.clear();
    this.touched.clear();
  }

  /** Whether anything is currently drawn. */
  get size(): number {
    return this.slots.size;
  }

  // ── Elements ────────────────────────────────────────────────────────────────

  text(
    key: string, x: number, y: number, content: string, style: Style,
    origin: [number, number] = [0, 0],
  ): Phaser.GameObjects.Text {
    const signature = JSON.stringify([x, y, content, style, origin]);
    const existing = this.reuse(key, signature);
    if (existing) return existing as Phaser.GameObjects.Text;

    const previous = this.slots.get(key)?.object as Phaser.GameObjects.Text | undefined;
    if (previous) {
      previous.setPosition(x, y).setText(content).setStyle(style).setOrigin(...origin);
      this.slots.get(key)!.signature = signature;
      return previous;
    }

    const text = this.scene.add.text(x, y, content, style).setOrigin(...origin);
    return this.adopt(key, text, signature) as Phaser.GameObjects.Text;
  }

  /**
   * A Graphics object cannot be inspected once drawn, so the caller says what
   * state it represents and the drawing is only redone when that changes.
   */
  graphics(
    key: string, signature: string, draw: (g: Phaser.GameObjects.Graphics) => void,
  ): Phaser.GameObjects.Graphics {
    const existing = this.reuse(key, signature);
    if (existing) return existing as Phaser.GameObjects.Graphics;

    const previous = this.slots.get(key)?.object as Phaser.GameObjects.Graphics | undefined;
    if (previous) {
      previous.clear();
      draw(previous);
      this.slots.get(key)!.signature = signature;
      return previous;
    }

    const g = this.scene.add.graphics();
    draw(g);
    return this.adopt(key, g, signature) as Phaser.GameObjects.Graphics;
  }

  rectangle(
    key: string, x: number, y: number, w: number, h: number, color: number,
    origin: [number, number] = [0, 0],
  ): Phaser.GameObjects.Rectangle {
    const signature = JSON.stringify(['rect', x, y, w, h, color, origin]);
    const existing = this.reuse(key, signature);
    if (existing) return existing as Phaser.GameObjects.Rectangle;

    const previous = this.slots.get(key)?.object as Phaser.GameObjects.Rectangle | undefined;
    if (previous) {
      previous.setPosition(x, y).setSize(w, h).setFillStyle(color).setOrigin(...origin);
      this.slots.get(key)!.signature = signature;
      return previous;
    }

    const rect = this.scene.add.rectangle(x, y, w, h, color).setOrigin(...origin);
    return this.adopt(key, rect, signature) as Phaser.GameObjects.Rectangle;
  }

  circle(
    key: string, x: number, y: number, radius: number, color: number,
  ): Phaser.GameObjects.Arc {
    const signature = JSON.stringify(['circle', x, y, radius, color]);
    const existing = this.reuse(key, signature);
    if (existing) return existing as Phaser.GameObjects.Arc;

    const previous = this.slots.get(key)?.object as Phaser.GameObjects.Arc | undefined;
    if (previous) {
      previous.setPosition(x, y).setRadius(radius).setFillStyle(color);
      this.slots.get(key)!.signature = signature;
      return previous;
    }

    const arc = this.scene.add.circle(x, y, radius, color).setStrokeStyle(1, 0xffffff);
    return this.adopt(key, arc, signature) as Phaser.GameObjects.Arc;
  }

  /**
   * A pressable label. The handler is replaced every render, the *listener* is
   * registered once — so hovering does not stop working when the view changes
   * underneath the cursor, and nothing accumulates.
   */
  button(key: string, x: number, y: number, spec: ButtonSpec): Phaser.GameObjects.Text {
    this.presses.set(key, spec.onPress);

    const origin = spec.origin ?? [0, 0];
    const signature = JSON.stringify([x, y, spec.label, spec.style, spec.hover, origin]);
    const existing = this.reuse(key, signature);
    if (existing) return existing as Phaser.GameObjects.Text;

    const previous = this.slots.get(key)?.object as Phaser.GameObjects.Text | undefined;
    const button = previous ?? this.scene.add.text(x, y, spec.label, spec.style);

    button.setPosition(x, y).setText(spec.label).setStyle(spec.style).setOrigin(...origin);
    button.setInteractive({ useHandCursor: true });

    if (!previous) {
      button.on('pointerdown', () => this.presses.get(key)?.());
      this.adopt(key, button, signature);
    } else {
      this.slots.get(key)!.signature = signature;
      this.touched.add(key);
    }

    // Re-bound each time because the colours are part of the view, not of the
    // object; the pointer *listener* above is the one that must not be re-added.
    button.off('pointerover');
    button.off('pointerout');
    if (spec.hover) {
      button.on('pointerover', () => button.setStyle({ backgroundColor: spec.hover!.on }));
      button.on('pointerout',  () => button.setStyle({ backgroundColor: spec.hover!.off }));
    }
    return button;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Mark a key as still present, and return its object if nothing changed. */
  private reuse(key: string, signature: string): Phaser.GameObjects.GameObject | null {
    this.touched.add(key);
    const slot = this.slots.get(key);
    return slot && slot.signature === signature ? slot.object : null;
  }

  private adopt(
    key: string, object: Phaser.GameObjects.GameObject, signature: string,
  ): Phaser.GameObjects.GameObject {
    this.container.add(object);
    this.slots.set(key, { object, signature });
    return object;
  }
}
