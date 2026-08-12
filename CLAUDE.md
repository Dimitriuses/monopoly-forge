# CLAUDE.md

Working notes for this repo — the commands, the invariants, and the traps that
have already cost time. Read [KNOWNISSUES.md](KNOWNISSUES.md) before concluding
that something is broken; several oddities here are known and deliberate.

## Commands

```bash
npm install
npm run dev          # Vite dev server, port 3000, debug logging on
npm run build        # tsc --noEmit && vite build → dist/
npm run typecheck    # tsc --noEmit
npm test             # Vitest, model only, plain Node (~8 s)
npm run test:watch
npm run playtest     # needs a build first — drives dist/ in headless Chromium
npm run screenshots  # playtest + writes screenshots/*.png
npm run verify:install  # would CI's npm accept package-lock.json?
```

`npm run playtest` accepts `--turns N`, `--seed N`, `--headed` (watch it play) and
`--url <url>` (drive a deployed site instead of `dist/`).

## Invariants

These are not style preferences. The project's destination is M8 — an engine for
Monopoly-style games with configurable maps, rules and presentation
([ROADMAP.md](ROADMAP.md)) — and invariants 1 and 2 are what keep that reachable:
a rules core that runs headlessly, and a renderer that can be replaced without
touching the rules. Breaking either forecloses the engine.

**1. The model must not import Phaser.** Everything under `game/`, `tiles/`,
`cards/` and `utils/` runs in plain Node — that is what makes it unit-testable
with no jsdom and no canvas. `src/config.ts` is the load-bearing part: it is
imported by the whole model, so the `Phaser.Game` options deliberately live in
`main.ts` instead. Adding `import Phaser from 'phaser'` to `config.ts` breaks the
entire test suite with `window is not defined`.

**2. A model class never imports a scene.** State changes are announced on the
typed `EventBus` singleton and scenes subscribe. This is what keeps the rules
testable and the renderer replaceable.

**3. Random numbers come from `rng`, never `Math.random`.** Dice and both deck
shuffles draw from the shared seeded Mulberry32 in `src/utils/PRNG.ts`. A stray
`Math.random` silently destroys reproducibility — and the playtest harness, which
relies on a seed producing the same game every run.

**6. Never write `40` or `10` for the board.** Both literals are gone. Length comes
from `board.size` (or `board.move` / `board.stepsBetween`, which wrap for you), and
jail and GO come from `board.anchor('jail')` / `board.anchor('start')`. `Board`
takes the map as a constructor argument, so a test can hand it a 12-tile board —
`tests/board.test.ts` does, and that is what stops the literals creeping back.

**7. The bank does not know the rules.** `Bank` moves cash and inventory and asks
no questions, because it has no view of the board — `bank.buyHouse` will happily
put a house on a lot whose colour group you do not own. Legality lives in
`game/BuildRules.ts`, and every path that builds, sells or mortgages must check
there first. The checks return a *reason*, which is what the property panel shows
when a button is dead.

**4. Use `dlog` / `dwarn`, not `console.log`.** `src/utils/log.ts` is silent
unless switched on (dev server, or `?debug=1` on any build). `console.error` is
deliberately *not* routed through it — real faults should always surface.

**5. `GameScene` ends turns through `safeEndTurn`, never `turnManager.endTurn()`
directly.** See the turn-end section below.

## Things that will bite

### Turn ending is guarded in two places, and both are needed

- `TurnManager._turnEndedThisRound` blocks an `endTurn()` re-entered *while*
  `endTurn` is on the stack.
- `GameScene.turnGen` blocks a *stale* `endTurn` from a `delayedCall` scheduled
  during a previous turn.

The flag cannot do the second job: `endTurn()` calls `startTurn()`, which clears
it. That was the "events get slower every turn" bug — a leftover timer ended the
*next* player's turn early, compounding each round. `tests/turns.test.ts` pins
both behaviours, including one test that asserts the flag's inability to block a
stale call, so the generation counter cannot be deleted as redundant.

### A jailed player's turn must not end synchronously

`TurnManager.handleJailRoll` emits `jail:stay` instead of calling `endTurn()`.
Ending the turn inside the roll button's own `pointerdown` callback runs
`endTurn → advancePlayer → startTurn → setRollEnabled(true) → setInteractive()`,
re-registering the button with Phaser's input plugin mid-event — after which the
next player's roll button is silently dead. `GameScene` defers with
`safeEndTurn(100)` to get out of the pointer-event frame.

### Cards that move the player must not also end the turn

In the `card:draw` handler, actions in `selfTerminating`
(`advanceTo`, `advanceToGo`, `goBack`, `goToJail`) resolve their own turn end via
the movement animation → `resolveLanding()` → `onLand()`, or via `jail:enter`.
Calling `safeEndTurn` for them as well races the animation (N tiles × 110 ms) and
lands `onLand` on the *next* player.

### Return a drawn card to the discard immediately

`deck.returnCard(card)` is called right after `drawCard()`, before `CardScene` is
launched — not from the scene's shutdown callback. If the scene never shuts down
(e.g. `scene.launch` is a no-op because it is already running), a deferred return
loses the card permanently and both decks eventually drain to nothing.

Also `scene.stop('CardScene')` before each `scene.launch`, or `once('shutdown')`
callbacks accumulate and fire together, executing several card effects at once.

### Positions are sanitised in three places, on purpose

`Board.move` uses `((f + s) % 40 + 40) % 40` because JS `%` preserves sign, and
`tiles[-1]` is `undefined`. `Board.getTile`/`getLayout` throw on non-finite input
instead of returning `undefined`, and `TurnManager` resets an out-of-range
`player.position` to 0 rather than propagating it. A corrupted position used to
cascade into every subsequent roll.

### The board is drawn once, its state many times

`ui/BoardRenderer.ts` holds everything inside the board square. `draw()` lays down
the static layer (tile outlines, colour stripes, names, click zones) and must be
called once; `refresh()` clears and redraws the *state* layer — owner bands,
houses, hotels, mortgage marks — and has to be called after anything that changes
tile state: buying, building, selling, mortgaging.

There is one loop over tiles, not one per side. Each tile's footprint, orientation
and which edge faces the board interior come from its `TileLayout`, so a new
decoration is written once rather than four times. `GameScene` keeps the tokens,
the buttons and the wiring.

### Phaser API traps

- `this.make.graphics({ add: false })` still *works* at runtime but no longer
  type-checks — `add` was dropped from `Graphics.Options`. Use
  `this.make.graphics({}, false)`; `addToScene` is the second argument. This is
  why `npm run build` failed while `npm run dev` was fine: Vite transpiles without
  type-checking, so `tsc` errors never surfaced during development.
- Removing a container child: `removeAt(1, true)` removes *and* destroys in one
  step. Calling `destroy()` first already removes it, so a following `removeAt(1)`
  is out of bounds.
- `setVisible(false)` does not remove an object from the input hit list — pair it
  with `disableInteractive()`, as `setJailBtnVisible` does, or invisible buttons
  still fire.
- `Phaser.Scene` already has a `renderer` property (the WebGL/Canvas renderer).
  A scene field of that name fails to compile with a misleading "type `this` is
  not assignable to parameter of type `Scene`" — `GameScene` calls its
  `BoardRenderer` `boardView` for that reason.

### A local `npm ci` does not prove CI will install

**Run `npm run verify:install` after any dependency change.** A passing local
`npm ci` is not evidence, because it uses *your* npm, and the lockfile is only
valid for the npm that consumes it.

This broke every CI job once. `npm install -D vitest@latest` brought in vitest 4,
which requires `vite ^6 || ^7 || ^8` while `package.json` pinned `vite ^5`. npm 11
resolved that by nesting a second Vite (the app built on Vite 5 while the tests
ran on a nested Vite 8) and then wrote a lockfile that recorded the nested Vite
but **not** its `esbuild@0.28.1` subtree. npm 11 reinstalls happily from its own
incomplete lockfile; npm 10 — bundled with Node 22, therefore the npm on the
runners — recomputed the tree, found 27 packages absent, and refused with
`Missing: esbuild@0.28.1 from lock file`.

Two rules follow:

- **Keep dependency majors aligned.** If a dev tool wants a different major of
  something `package.json` already pins, fix the range rather than letting npm
  nest a second copy. Check 3 of `verify:install` fails on exactly that.
- **Node and npm come as a pair.** CI resolves Node from `.nvmrc`
  (`node-version-file`), so the npm major is whatever that Node bundles. Both
  workflows print `node --version && npm --version` before installing.

### The playtest harness clicks fixed coordinates

The game is one canvas with no DOM controls, so `tools/playtest.mjs` clicks board
pixel positions from its `HOTSPOTS` table. **Move a button in a scene and you must
update that table**, or the harness clicks empty space and fails with a vague
"no property was bought in the whole run".

`GameScene.exposeDebugHandle()` publishes `window.__forge` (state, phase,
`isAnimating`, whether a prompt, card or property panel is open) so the harness can
assert on real model state rather than pixels. It is gated on the same switch as
debug logging, so a plain production load exposes nothing.

Board *tiles* are the exception to the hotspot table: `__forge.tileCentre(id)`
returns a tile's centre, so the harness clicks tiles without keeping its own copy
of the board geometry. Keep it that way — the table is for scene buttons only.

## Deployment

`vite.config.ts` sets `base: './'` — relative asset paths, so one build serves
from the dev server, from `vite preview`, and from
`https://<user>.github.io/monopoly-forge/` with no repo name compiled in. There is
no client-side routing, so no `404.html` fallback is needed.

`.github/workflows/ci.yml` runs typecheck + tests + build on Linux and Windows,
plus the browser playtest; `pages.yml` deploys `dist/` to GitHub Pages.

## Style

Match the surrounding code: two-space indent, single quotes, semicolons, aligned
trailing comments and the `// ─── Section ───` banner comments. Comments explain
*why* — several in this codebase record a bug that a plausible-looking
simplification would reintroduce. Leave those in place.
