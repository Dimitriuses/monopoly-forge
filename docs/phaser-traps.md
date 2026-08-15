# Phaser API traps

Things about Phaser 3 that have cost this project time. Look here when something
renders, compiles or clicks in a way that makes no sense — not something to carry
around. [CLAUDE.md](../CLAUDE.md) keeps the two that bite most often.

---


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
- **Toggle a button with `disableInteractive()`, never `removeInteractive()`.**
  The destructive one queues the object for removal from the input plugin's list.
  Disable and re-enable it in the *same frame* — which every turn change does,
  `turn:end` off and `turn:start` on — and the next `preUpdate` clears the input
  object that `setInteractive()` just created while re-inserting the button. It
  sits there at full alpha, looking fine, and never fires again. `setInteractive`
  on an object that already has `input` just flips `enabled`, so the pair is safe.
  This killed ROLL DICE after three doubles sent a player to jail; see DEVLOG.
- **`Phaser.Scene` already owns some obvious field names**, and a scene field
  that collides fails to compile with the misleading "type `this` is not
  assignable to parameter of type `Scene`". Two have been hit: `renderer` (the
  WebGL/Canvas renderer), which is why `GameScene` calls its `BoardRenderer`
  `boardView`; and **`data`** (the scene's `DataManager`), which is why
  `PauseScene` calls its init payload `paused`. Check the name before adding a
  field — the error names neither the property nor the file.

