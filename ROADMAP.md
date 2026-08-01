# Roadmap

Where Monopoly Forge is going. Defects that exist *today* are listed separately in
[KNOWNISSUES.md](KNOWNISSUES.md); this file is about work not yet done.

**Status:** active. The turn loop, cards, jail and rent all work end to end — a
seeded 45-turn game runs with no console errors (`npm run playtest`). The next
milestone is what turns a working rules engine into a game worth finishing:
visible ownership and property development.

---

## M3 — Ownership and development · next

The model is already written and unit-tested; what is missing is the interface and
the rule enforcement around it.

- [ ] **Draw ownership on the board.** An owner-coloured bar or token pip per tile.
      Nothing else on this list matters until you can see who owns what
      (see *Property ownership is invisible* in KNOWNISSUES).
- [ ] **Property detail panel.** Click a tile: full rent ladder, house cost,
      mortgage value, current owner.
- [ ] **Build houses and hotels.** `Bank.buyHouse` / `buyHotel` exist and pass
      tests, including returning four houses to the bank stock when a hotel goes
      up. They need a build UI and the two rules that are *not* in the model yet:
      you must own the whole colour group, and houses must stay within one of each
      other across the group.
- [ ] **Mortgage / unmortgage UI.** Also model-complete (110% to lift), also
      unreachable.
- [ ] **Render houses and hotels.** `BootScene` already generates `house` and
      `hotel` textures that nothing draws yet.

## M4 — Cards and jail edge cases

- [ ] **Fix the `goBack` animation direction** — thread a signed direction through
      `player:move` so the token walks backwards.
- [ ] **Real "nearest railroad" / "nearest utility" cards**, replacing the two
      hard-coded destinations, including the doubled railroad rent when arriving
      by card.
- [ ] **Get Out of Jail Free cards return to the bottom of their deck** when
      spent. They are currently withheld from the deck for the rest of the game;
      `CardDeck` handles the resulting shortage gracefully, but it is not correct.

## M5 — Multiplayer interaction

- [ ] **Auctions.** The event is already named `property:auction`; only the
      Buy/Pass prompt exists. Needs round-robin bidding with a per-turn timer and
      a pass-forfeits rule.
- [ ] **Trading.** Offer/counter-offer over properties, cash and jail cards, with
      both sides confirming.
- [ ] **Proper bankruptcy settlement** — forced mortgaging and selling before
      being declared bankrupt, then transferring the whole estate to the creditor.
      This is a prerequisite for the win condition meaning anything.

## M6 — Polish

- [ ] **Wire up save/load.** See *Blocked / deferred* below — this is not the
      small job it looks like.
- [ ] **Make the house rules real.** Four flags (`freeParkingJackpot`,
      `doubleGoSalary`, `noAuction`, `speedDie`) are declared and read by nothing.
      Either implement them or delete the type.
- [ ] **Use the empty right-hand third of the canvas.** The board occupies
      x≈80–760 and the HUD starts at x=1055, leaving a dead column; the turn log
      and property panel belong there.
- [ ] **Stop toasts covering the roll button.** Notifications stack upward from
      y=760, directly over the ROLL DICE button at y=738.
- [ ] Sound effects, and a proper token sprite instead of a coloured circle.

## M7 — Quality

- [ ] **A basic AI opponent**, so a single player can finish a game. The seeded
      PRNG and the Phaser-free model make headless simulation straightforward —
      a bot that plays thousands of games is also the fastest way to find the
      remaining rule bugs.
- [ ] **Balance pass** driven by those simulations: bankruptcy rates, game length,
      how often the bank runs out of houses.
- [ ] **Extend the playtest harness** to assert on richer invariants (total cash
      conservation across the whole table, deck census over a long game).

---

## Blocked / deferred, with reasons

### Save/load needs a deserialiser, not a save button

`SaveLoad.ts` (localStorage, versioned) and `GameScene.serialize()` both work, and
`serialize()` is what the playtest harness reads state through. Restoring is the
hard half and is genuinely not written:

- `Board.toJSON()` emits tile ownership and house counts, but there is no
  `fromJSON` on any model class — every class would need one.
- **Deck state is not serialised at all.** `CardDeck` keeps its draw and discard
  piles in private arrays with no `toJSON`, so a restored game would reshuffle
  both decks and hand out cards a player has already seen.
- The PRNG stream position is not captured either. `PRNG.getSeed()` returns the
  *current* state, which is actually the right value to persist — but nothing
  calls it, and restoring it has to happen before any deck is rebuilt or the
  shuffles diverge.
- Phaser state (token sprites, the active scene, an open card overlay) has to be
  rebuilt to match, which means a restore path through `GameScene.create()`
  rather than a simple field assignment.

Deferred until after M3, because the ownership work changes the shape of the state
that would need saving.

### Multiple simultaneous animations

Movement is a chain of awaited tweens guarded by a single `isAnimating` flag, so
exactly one token can move at a time. Fine for hot-seat play; it would need
rethinking for any form of simultaneous or networked turns. Not planned.

### Networked multiplayer

Not planned. The `EventBus` is a plausible seam for it — the model already emits
every state change as an event and imports no Phaser — but authoritative state,
reconnection and anti-cheat are a different project.

### Mobile / responsive layout

The canvas is a fixed 1280×800 with no Phaser Scale Manager configuration, so on a
small screen it is simply cut off. Fixing it properly means reflowing the board
and the HUD, not just scaling, since the tile labels are already 6px.

---

## Not on the roadmap

- **Official Monopoly assets or branding.** This is an independent implementation
  of the public-domain-era board layout using generic tile names; the artwork is
  drawn procedurally in code. It is not affiliated with Hasbro.
- **An in-game asset pipeline.** `BootScene` generates its placeholder textures at
  runtime, which keeps the repo free of third-party art and its licence questions.
