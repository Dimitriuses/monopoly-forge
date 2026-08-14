import Phaser from 'phaser';
import { SaveLoad, type SlotSummary } from '@/utils/SaveLoad';
import { GAMES } from '@/games';
import { theme, setTheme, knownThemes } from '@/ui/Theme';
import { bakeTokenTextures, bakeBuildingTextures } from '@/ui/Textures';
import { Menu, backItem, type MenuItem, type MenuScreen } from '@/ui/Menu';
import { sfx } from '@/ui/Sfx';

// ─── PauseScene ───────────────────────────────────────────────────────────────
// The same menu as the title screen, over a game in progress.
//
// It renders from `ui/Menu.ts` for the reason that module exists: written as its
// own scene it would be a second implementation of rows, hover, back and Escape,
// and the two would have drifted apart inside this milestone.
//
// One rule it must not soften: **Save is a button that says why it is dead.** A
// restore resumes at the start of a turn, so saving is refused mid-animation,
// mid-auction and mid-trade — and a missing button teaches nobody that, where a
// greyed one with "finish what you are doing first" does. That is the same
// bargain the property panel's build buttons already make.

export interface PauseData {
  /** Whether the game can be saved right now, and why not if it cannot. */
  canSave: boolean;
  saveReason?: string;
  /** Called with the chosen slot; the scene stays open so a failure is visible. */
  onSave(slot: number): void;
  onQuit(): void;
  /** Which game is being played, for the slot list. */
  gameId: string;
  round: number;
}

export class PauseScene extends Phaser.Scene {
  private menu!: Menu;
  /**
   * Not `data`: `Phaser.Scene` already has one (its `DataManager`), and a field
   * of that name fails to compile with the misleading "type `this` is not
   * assignable to parameter of type `Scene`". The same trap `GameScene` hit with
   * `renderer` — see CLAUDE.md.
   */
  private paused!: PauseData;
  /** Set after a save, so the row can say so rather than looking inert. */
  private savedTo: number | null = null;

  constructor() {
    super({ key: 'PauseScene' });
  }

  init(data: PauseData): void {
    this.paused = data;
    this.savedTo = null;
  }

  create(): void {
    const { width, height } = this.scale;
    const t = theme();

    // A scrim rather than an opaque page: the board stays visible behind, which
    // is what makes this read as *paused* instead of as having left the game.
    this.add.rectangle(0, 0, width, height, t.chrome.page, 0.88).setOrigin(0)
      .setInteractive();   // swallows clicks so the board underneath is inert

    this.add.text(width / 2, 90, '⏸  PAUSED', {
      fontFamily: t.font.display, fontSize: '32px', color: t.chrome.heading,
    }).setOrigin(0.5);

    this.menu = new Menu(this, () => this.rootScreen());
    // Escape on the root closes the pause menu, which is what pressed it.
    this.menu.onExitRoot = () => this.resume();
    this.menu.render();
    this.exposeMenuHandle();
  }

  private rootScreen(): MenuScreen {
    const items: MenuItem[] = [
      { id: 'resume', label: 'Resume', primary: true, onPress: () => this.resume() },
      { id: 'save', label: 'Save', kind: 'submenu',
        value: this.savedTo ? `saved to slot ${this.savedTo}` : undefined,
        enabled: this.paused.canSave,
        reason: this.paused.saveReason ?? 'Finish what you are doing first',
        onPress: () => this.menu.open(() => this.saveScreen()) },
      { id: 'settings', label: 'Settings', kind: 'submenu',
        onPress: () => this.menu.open(() => this.settingsScreen()) },
      { id: 'quit', label: 'Quit to menu', kind: 'submenu',
        onPress: () => this.menu.open(() => this.quitScreen()) },
    ];
    return { title: 'Paused', items };
  }

  private saveScreen(): MenuScreen {
    const items: MenuItem[] = SaveLoad.slots().map((slot) => ({
      id: `slot${slot.slot}`,
      label: `Slot ${slot.slot}`,
      kind: 'value' as const,
      value: slot.used ? describeSlot(slot) : 'empty',
      hint: slot.used ? `overwrite — ${new Date(slot.timestamp).toLocaleString()}` : undefined,
      onPress: () => {
        this.paused.onSave(slot.slot);
        this.savedTo = slot.slot;
        this.menu.back();
      },
    }));
    items.push(backItem(this.menu));
    return { title: 'Save', subtitle: 'Choose a slot', items };
  }

  private settingsScreen(): MenuScreen {
    return {
      title: 'Settings',
      items: [
        { id: 'sound', label: 'Sound', kind: 'value',
          value: sfx.muted ? 'off' : `${Math.round(sfx.volume * 100)}%`,
          onAdjust: (d) => { sfx.setVolume(sfx.volume + d * 0.1); this.menu.render(); },
          onPress: () => { sfx.toggleMute(); this.menu.render(); } },
        { id: 'theme', label: 'Theme', kind: 'value', value: theme().name,
          // Honest rather than hidden: the board's static layer and the pieces
          // are drawn once at `create()`, so a palette switched here lands on the
          // next game. Making it live is its own M10 item.
          hint: 'Applies to the next game — the board is drawn once',
          onAdjust: (d) => { this.cycleTheme(d); this.menu.render(); } },
        backItem(this.menu),
      ],
    };
  }

  /** Quitting discards an unsaved game, so it asks. */
  private quitScreen(): MenuScreen {
    return {
      title: 'Quit to menu',
      subtitle: this.savedTo ? 'This game is saved.' : 'This game has not been saved.',
      items: [
        { id: 'confirm', label: 'Quit — discard this game', primary: true,
          onPress: () => this.paused.onQuit() },
        backItem(this.menu, 'Keep playing'),
      ],
    };
  }

  private cycleTheme(delta: 1 | -1): void {
    const ids = knownThemes().map((t) => t.id);
    const at = ids.indexOf(theme().id);
    setTheme(ids[((at < 0 ? 0 : at) + delta + ids.length) % ids.length]);
    bakeTokenTextures(this);
    bakeBuildingTextures(this);
  }

  private resume(): void {
    this.menu.destroy();
    this.scene.stop();
    this.scene.resume('GameScene');
  }

  private exposeMenuHandle(): void {
    (window as unknown as Record<string, unknown>).__menu = {
      title: () => this.menu.title,
      depth: () => this.menu.depth,
      spots: () => this.menu.spots(),
      back: () => { this.menu.back(); },
    };
  }
}

function describeSlot(slot: SlotSummary): string {
  const name = GAMES[slot.gameId]?.name ?? slot.gameId ?? 'game';
  return slot.round ? `${name}, round ${slot.round}` : name;
}
