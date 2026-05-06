import Phaser from 'phaser';

export type NotifType = 'info' | 'success' | 'warning' | 'danger';

const BG_COLORS: Record<NotifType, number> = {
  info:    0x2c3e6b,
  success: 0x1e5c2e,
  warning: 0x6b4d10,
  danger:  0x6b1e1e,
};

const BORDER_COLORS: Record<NotifType, number> = {
  info:    0x5577cc,
  success: 0x2ecc71,
  warning: 0xf0c040,
  danger:  0xe74c3c,
};

const TOAST_W = 320;
const TOAST_H = 54;
const TOAST_X = 520;   // center of board area
const TOAST_BASE_Y = 760;

interface Toast {
  container: Phaser.GameObjects.Container;
}

export class Notification {
  private scene:  Phaser.Scene;
  private stack:  Toast[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(message: string, type: NotifType = 'info', duration = 2200): void {
    // Slide existing toasts up
    this.stack.forEach((t) => {
      this.scene.tweens.add({
        targets: t.container,
        y: t.container.y - (TOAST_H + 8),
        duration: 200,
        ease: 'Sine.easeOut',
      });
    });

    const g = this.scene.add.graphics();
    g.fillStyle(BG_COLORS[type], 0.95);
    g.fillRoundedRect(-TOAST_W / 2, -TOAST_H / 2, TOAST_W, TOAST_H, 8);
    g.lineStyle(1.5, BORDER_COLORS[type], 1);
    g.strokeRoundedRect(-TOAST_W / 2, -TOAST_H / 2, TOAST_W, TOAST_H, 8);

    const text = this.scene.add.text(0, 0, message, {
      fontFamily: 'Georgia, serif',
      fontSize: '13px',
      color: '#ffffff',
      wordWrap: { width: TOAST_W - 24 },
      align: 'center',
    }).setOrigin(0.5);

    const container = this.scene.add.container(TOAST_X, TOAST_BASE_Y + 60, [g, text]);
    container.setDepth(50).setAlpha(0);

    const toast: Toast = { container };
    this.stack.push(toast);

    // Slide in
    this.scene.tweens.add({
      targets: container,
      y: TOAST_BASE_Y,
      alpha: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });

    // Auto dismiss
    this.scene.time.delayedCall(duration, () => this.dismiss(toast));
  }

  private dismiss(toast: Toast): void {
    this.scene.tweens.add({
      targets: toast.container,
      alpha: 0,
      y: toast.container.y + 20,
      duration: 300,
      ease: 'Sine.easeIn',
      onComplete: () => {
        toast.container.destroy();
        this.stack = this.stack.filter((t) => t !== toast);
      },
    });
  }
}
