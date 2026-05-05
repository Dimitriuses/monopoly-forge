# 🏦 Monopoly Forge

A custom, fully-featured Monopoly game built with **Phaser 3**, **TypeScript 5**, and **Vite**.

---

## Quick Start

```bash
npm install
npm run dev        # starts Vite dev server at http://localhost:3000
npm run build      # production build → dist/
npm run typecheck  # run tsc without emitting
```

---

## Tech Stack

| Layer     | Choice                      | Reason                                                    |
|-----------|-----------------------------|-----------------------------------------------------------|
| Language  | TypeScript 5.x              | Type safety, OOP, great IDE support                       |
| Renderer  | Phaser 3                    | 2D game framework with scenes, tweens, input              |
| Build     | Vite                        | Fast HMR, native TS support                               |
| State     | Custom EventBus + plain classes | No Redux overhead for a turn-based game               |
| Assets    | Phaser Atlas (TexturePacker) | Sprite sheets for board, tokens, cards (planned M1)      |

---

## Architecture

```
src/
├── main.ts                   # Phaser.Game bootstrap
├── config.ts                 # Game config, board data, rules constants
├── scenes/
│   ├── BootScene.ts          # Asset preloading
│   ├── MenuScene.ts          # Player setup (count, names, tokens)
│   ├── GameScene.ts          # Main game loop & board rendering
│   ├── CardScene.ts          # Chance / Community Chest overlay
│   └── UIScene.ts            # HUD (always-on top scene)
├── game/
│   ├── Board.ts              # 40-tile board model + layout math
│   ├── Player.ts             # Player state: position, cash, properties
│   ├── Dice.ts               # Roll logic, doubles tracking
│   ├── TurnManager.ts        # Phase FSM (roll → land → action → end)
│   ├── Bank.ts               # Cash pool, mortgages, auctions
│   ├── Auction.ts            # Auction round-robin logic            [M5]
│   └── TradeManager.ts       # Offer / counter-offer logic          [M5]
├── tiles/
│   ├── Tile.ts               # Base tile class
│   ├── PropertyTile.ts       # Color group, rent tiers, houses/hotel
│   └── SpecialTiles.ts       # Railroad, Utility, Tax, Card, Jail, Go, FreeParking, GoToJail
├── cards/
│   └── CardDeck.ts           # Deck, shuffle, draw, all card effects
├── ui/
│   ├── BoardRenderer.ts      # Draw tiles, tokens, houses/hotels     [M2]
│   ├── DiceView.ts           # Animated dice sprites                 [M2]
│   ├── PlayerPanel.ts        # Per-player cash + property list       [M5]
│   ├── PropertyCard.ts       # Full property detail popup            [M3]
│   ├── TradeDialog.ts        # Drag-and-drop trade UI               [M5]
│   ├── AuctionDialog.ts      # Timer + bid buttons                  [M5]
│   └── Notification.ts       # Toast / modal helper                 [M5]
└── utils/
    ├── EventBus.ts           # Typed game-wide event emitter
    ├── PRNG.ts               # Seeded random (reproducible games)
    └── SaveLoad.ts           # JSON serialise/deserialise full state
```

---

## Core Game Elements

### The Board
- **40 tiles** arranged in a loop; corners at indices 0, 10, 20, 30.
- Layout rendered by `GameScene` using a pre-computed position table (tile index → screen coordinates + rotation angle).
- Color-group overlays drawn per `PropertyTile` group (Brown, Light Blue, Pink, Orange, Red, Yellow, Green, Dark Blue).
- Houses and hotels are Phaser sprites placed on each tile's designated slots.

### Tile Types

| Type             | Count | Key Data                                          |
|------------------|-------|---------------------------------------------------|
| Go               | 1     | Award $200 on pass/land                           |
| Property         | 22    | Group, price, rent[0–6], house cost, mortgage     |
| Railroad         | 4     | Price $200, rent $25/$50/$100/$200                |
| Utility          | 2     | Price $150, rent = 4× or 10× dice                 |
| Tax              | 2     | Income Tax $200, Luxury Tax $100                  |
| Chance           | 3     | Draw from 16-card deck                            |
| Community Chest  | 3     | Draw from 17-card deck                            |
| Jail             | 1     | Dual state: Just Visiting / In Jail               |
| Free Parking     | 1     | Configurable (vanilla = nothing)                  |
| Go to Jail       | 1     | Move to Jail, no $200                             |

### Player Model
```typescript
class Player {
  id: string;
  name: string;
  token: TokenType;           // Top hat, Car, Dog, Iron, Ship, etc.
  cash: number;
  position: number;           // 0–39
  inJail: boolean;
  jailTurns: number;          // 0–3
  getOutOfJailCards: number;
  ownedTileIds: Set<number>;
  isBankrupt: boolean;
}
```

### Turn Phase FSM (`TurnManager`)

```
WAITING_FOR_ROLL
    │  player clicks Roll
    ▼
ROLLING  (dice animation ~600 ms)
    │
    ├─ doubles? ──► MOVING → land → action → back to WAITING_FOR_ROLL
    │               (3rd double → GO TO JAIL)
    │
    └─ no doubles ► MOVING
                        │
                     LANDING
                        │
              ┌─────────┴──────────┐
           BUYING             OTHER_ACTION
         (unowned prop)     (rent / tax / card / jail)
              │
           END_TURN ──► next player
```

### Property Ownership & Development
- A player **must own all tiles in a color group** before buying houses.
- Houses must be built **evenly** across the group (±1 at all times).
- 32 houses and 12 hotels are physical bank inventory — they can run out.
- Selling houses returns half the purchase price per house.
- **Mortgage**: owner gets half price; no rent collected while mortgaged; unmortgage costs 110% of face value.

### Card Decks
Each deck is shuffled at game start; when exhausted, reshuffled (excluding cards held by players).

**Chance cards (16):** Advance to Go, Advance to Boardwalk, Go to Jail, Go Back 3 Spaces, Bank pays dividend, Street Repairs (pay per house/hotel), Get Out of Jail Free, and several "Advance to [specific tile]" cards.

**Community Chest cards (17):** Collect/pay various fixed amounts (doctor, beauty contest, inheritance, sale of stock), Advance to Go, Go to Jail, Get Out of Jail Free, pay per house/hotel.

### Auction System
Triggered when a player **declines to buy** an unowned property. All non-bankrupt players, including the one who landed, can bid:
- Minimum bid: $1.
- Round-robin with a 15-second timer per turn.
- Passing forfeits the rest of the auction for that player.
- Highest bidder when everyone else passes wins.

### Trade System
Any player on their own turn may initiate a trade:
- Select target player.
- Drag properties, cash, and Get Out of Jail Free cards to each side.
- Counteroffers supported.
- Both parties must confirm; either can cancel.

### Jail Rules

**Ways to enter jail:**
- Land on "Go to Jail"
- Draw a Go to Jail card
- Roll doubles three times in a row

**Ways to leave jail:**
- Pay $50 fine on your turn before rolling
- Use a Get Out of Jail Free card
- Roll doubles (still only move that roll's distance, no bonus turn)

After 3 turns in jail the player **must** pay $50 and roll.

### Bankruptcy & Win Condition
- If a player cannot pay a debt (rent, tax, card penalty) and cannot raise funds by mortgaging/selling, they are **bankrupt**.
- All their assets transfer to the creditor (another player or the Bank).
- Last player standing wins; alternatively, a **time limit** variant ends on highest net worth.

---

## Development Milestones

| Phase | Deliverable |
|-------|-------------|
| **M1 — Foundation** | Vite + Phaser 3 + TS scaffolding, BootScene, asset pipeline, board renders correctly ✅ |
| **M2 — Core Loop** | Player tokens move, dice roll, tile landing, rent/tax/Go logic |
| **M3 — Ownership** | Buy property, mortgage, house/hotel build rules, color-group enforcement |
| **M4 — Cards & Jail** | Card decks with all effects, jail enter/exit flows |
| **M5 — Multiplayer UI** | Trade dialog, auction system, player panels, notifications |
| **M6 — Polish** | Animations, sound FX, save/load, house rules toggle (Free Parking jackpot, etc.) |
| **M7 — QA** | AI opponent (basic), edge-case testing (bankruptcy chains, hotel shortage), balance tuning |

---

## House Rules (Toggleable Flags)

```typescript
const HOUSE_RULES = {
  freeParkingJackpot: boolean,   // taxes/fines go to pot on Free Parking
  doubleGoSalary: boolean,       // $400 if you land exactly on Go
  noAuction: boolean,            // declined property just stays unowned
  speedDie: boolean,             // 3rd die with Bus/Mr. Monopoly/1–3 pips
};
```

Configure via `DEFAULT_HOUSE_RULES` in `src/config.ts`.

---

## EventBus — Typed Events

All game modules communicate via a lightweight pub/sub bus. Never import a scene from a model class — emit an event instead.

```typescript
import { bus } from '@/utils/EventBus';

// Emit
bus.emit('rent:pay', { debtorId, creditorId, amount, tileId });

// Listen
bus.on('rent:pay', ({ amount }) => { /* update UI */ });
```

Full catalogue of events lives in `src/utils/EventBus.ts`.

---

## Seeded PRNG

All random operations (dice rolls, deck shuffles) go through `src/utils/PRNG.ts`. Pass a seed at game start to reproduce any game exactly — useful for testing and replays.

```typescript
import { rng } from '@/utils/PRNG';
rng['state'] = 12345; // deterministic replay
```

---

## Save / Load

`src/utils/SaveLoad.ts` serialises the full game state to `localStorage`. Call `GameScene.serialize()` to capture state, then `SaveLoad.save()` to persist it.

---

## Contributing

1. Follow the milestone order — don't wire UI before the model is solid.
2. All cross-module communication goes through `EventBus`, not direct imports.
3. New tile types extend `Tile` and implement `onLand()`.
4. New card effects extend the `CardAction` union in `CardDeck.ts`.
