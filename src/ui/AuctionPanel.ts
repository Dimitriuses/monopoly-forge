import Phaser from 'phaser';
import { theme } from './Theme';
import { Surface } from './Retained';

// ─── AuctionPanel ─────────────────────────────────────────────────────────────
// The bidding modal. Like PropertyPanel it renders a view model and reports
// presses; the Auction class in game/ owns the rules. The one thing it does own
// is the clock: each bidder gets a countdown, and running it out is a pass —
// which is why the timer lives next to the buttons rather than in the model.

export interface AuctionView {
  tileName: string;
  subtitle: string;
  groupColor: number | null;
  /** Face price of the deed, shown as a yardstick for the bidding. */
  price: number;
  bidderName: string;
  bidderColor: number;
  bidderCash: number;
  highBid: number;
  highBidderName: string | null;
  /** Bid amounts to offer; any the bidder cannot cover are drawn dead. */
  options: number[];
  /** Everyone still in the running, in seat order. */
  remaining: string[];
  secondsPerBid: number;
}

const W = 420;
const H = 280;

export class AuctionPanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private surface: Surface;
  private onBid: (amount: number) => void;
  private onPass: () => void;
  private timer: Phaser.Time.TimerEvent | null = null;
  private clockBar: Phaser.GameObjects.Rectangle | null = null;

  constructor(
    scene: Phaser.Scene,
    onBid: (amount: number) => void,
    onPass: () => void,
  ) {
    this.scene     = scene;
    this.onBid     = onBid;
    this.onPass    = onPass;
    this.container = scene.add.container(512, 400).setDepth(45).setVisible(false);
    this.surface   = new Surface(scene, this.container);
  }

  get isOpen(): boolean { return this.container.visible; }

  // No render memo here, unlike PropertyPanel and TradePanel: show() also restarts
  // the bid clock, so skipping a redraw would silently skip a bidder's timer. It
  // is only ever called when the auction state has actually moved on anyway.

  hide(): void {
    this.stopClock();
    this.clockBar?.destroy();
    this.clockBar = null;
    this.surface.clear();
    this.container.setVisible(false);
  }

  show(view: AuctionView): void {
    this.stopClock();

    const t = theme();
    const s = this.surface;
    s.begin();

    s.graphics('frame', `${view.groupColor}`, (g) => {
      // Opaque: at 0.98 the board's centrepiece emoji glows faintly through it.
      g.fillStyle(t.panel.background, 1);
      g.fillRoundedRect(-W / 2, -H / 2, W, H, 8);
      g.lineStyle(2, t.board.selection, 1);
      g.strokeRoundedRect(-W / 2, -H / 2, W, H, 8);
      if (view.groupColor !== null) {
        g.fillStyle(view.groupColor, 1);
        g.fillRect(-W / 2 + 2, -H / 2 + 2, W - 4, 7);
      }
    });

    s.text('heading', 0, -H / 2 + 16, '🔨  AUCTION', {
      fontFamily: t.font.display, fontSize: '13px', color: t.panel.title, fontStyle: 'bold',
    }, [0.5, 0]);

    s.text('name', 0, -H / 2 + 36, view.tileName, {
      fontFamily: t.font.display, fontSize: '20px',
      color: t.panel.button.text, fontStyle: 'bold',
    }, [0.5, 0]);

    s.text('subtitle', 0, -H / 2 + 60, `${view.subtitle}   ·   list price $${view.price}`, {
      fontFamily: t.font.display, fontSize: '11px', color: t.chrome.dim,
    }, [0.5, 0]);

    // ── Standing bid ──────────────────────────────────────────────────────────
    s.text('standing', 0, -H / 2 + 84, view.highBidderName
      ? `${view.highBidderName} leads at $${view.highBid}`
      : 'No bids yet', {
      fontFamily: t.font.display, fontSize: '14px',
      color: view.highBidderName ? t.chrome.positive : t.panel.dim,
    }, [0.5, 0]);

    // ── Whose turn ────────────────────────────────────────────────────────────
    s.circle('bidderDot', -96, -H / 2 + 118, 7, view.bidderColor);
    s.text('bidder', -82, -H / 2 + 110,
      `${view.bidderName} to bid   ·   $${view.bidderCash.toLocaleString()} in hand`, {
        fontFamily: t.font.display, fontSize: '13px', color: t.chrome.text,
      });

    // ── Clock ─────────────────────────────────────────────────────────────────
    s.rectangle('clockTrack', -W / 2 + 20, -H / 2 + 136, W - 40, 4, t.panel.highlight);
    // Rebuilt every render on purpose: its width is animated away by the clock,
    // so the retained copy is never in the state the signature would claim.
    this.clockBar?.destroy();
    this.clockBar = this.scene.add
      .rectangle(-W / 2 + 20, -H / 2 + 136, W - 40, 4, t.board.selection)
      .setOrigin(0, 0);
    this.container.add(this.clockBar);

    // ── Bid buttons ───────────────────────────────────────────────────────────
    view.options.forEach((amount, i) => {
      const affordable = amount <= view.bidderCash;
      const off = affordable ? t.panel.button.on : t.panel.button.off;
      // Three 120px buttons with 10px gutters exactly fill the frame's inner
      // width (420 - 2×20); anything wider spills over the border.
      s.button(`bid:${i}`, -W / 2 + 20 + i * 130, 26, {
        label: `Bid $${amount}`,
        style: {
          fontFamily: t.font.display, fontSize: '14px',
          color: affordable ? t.panel.button.text : t.panel.button.textOff,
          backgroundColor: off, padding: { x: 10, y: 9 },
          fixedWidth: 120, align: 'center',
        },
        hover: { on: affordable ? t.panel.button.hover : off, off },
        origin: [0, 0.5],
        onPress: () => {
          if (!affordable) return;
          this.stopClock();
          this.onBid(amount);
        },
      });
    });

    s.button('pass', 0, 84, {
      label: '❌  PASS — and you are out',
      style: {
        fontFamily: t.font.display, fontSize: '14px', color: t.chrome.primary.text,
        backgroundColor: t.chrome.primary.fill, padding: { x: 18, y: 9 },
      },
      hover: { on: t.chrome.primary.hover, off: t.chrome.primary.fill },
      origin: [0.5, 0.5],
      onPress: () => { this.stopClock(); this.onPass(); },
    });

    s.text('remaining', 0, H / 2 - 22, `Still bidding: ${view.remaining.join(', ')}`, {
      fontFamily: t.font.display, fontSize: '10px', color: t.panel.subtitle,
      wordWrap: { width: W - 40 }, align: 'center',
    }, [0.5, 0]);

    s.end();
    this.container.setVisible(true);
    this.startClock(view.secondsPerBid);
  }

  // ── Clock ───────────────────────────────────────────────────────────────────

  private startClock(seconds: number): void {
    const bar = this.clockBar;
    if (!bar || seconds <= 0) return;
    const full = bar.width;

    this.timer = this.scene.time.addEvent({
      delay: 100,
      repeat: seconds * 10,
      callback: () => {
        const left = 1 - (this.timer?.getOverallProgress() ?? 1);
        bar.width = full * left;
        bar.fillColor = left < 0.3 ? theme().log.accent.danger : theme().board.selection;
        // Running the clock out is a pass — the rule that keeps a hot-seat
        // auction from stalling on a player who has walked away.
        if (left <= 0) { this.stopClock(); this.onPass(); }
      },
    });
  }

  private stopClock(): void {
    this.timer?.remove();
    this.timer = null;
  }
}
