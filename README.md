# Dice Flip

A minimal, tactile dice flipper built with React + TypeScript + Vite.  
Designed to be embedded in other games as a library.

## How it works

- **Hold** anywhere on the panel to spin all dice
- **Release** to let them coast to a random result
- While dice are coasting you cannot start a new roll — wait for them all to land
- Once every die has landed, the **Total** is shown (with 2+ dice)
- Press **+** (top-right corner) to add more dice (when enabled)

## Using `DicePanel` in your project

Install the package:

```bash
npm install dice-flip
```

Import the component and its styles:

```tsx
import { DicePanel } from 'dice-flip'
import 'dice-flip/dist/index.css'
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `diceCount` | `number` | `1` | Number of dice to start with. |
| `showAddButton` | `boolean` | `true` | Show or hide the **+** button that lets the player add more dice at runtime. |
| `transparent` | `boolean` | `false` | When `true`, removes the panel background, border and box-shadow — ideal for placing the component directly over a custom game UI. |
| `onDieLanded` | `(index: number, value: number) => void` | — | Called each time an individual die lands. `index` is the die's 0-based position in the panel; `value` is its result (1–6). |
| `onAllLanded` | `(results: number[], total: number) => void` | — | Called once every die in a roll has landed. `results` contains each die's value in order; `total` is their sum. |

### Examples

**Single die, no add button**
```tsx
<DicePanel diceCount={1} showAddButton={false} />
```

**Two dice, fixed count, with result callbacks**
```tsx
<DicePanel
  diceCount={2}
  showAddButton={false}
  onDieLanded={(index, value) => {
    console.log(`Die ${index} landed on ${value}`)
  }}
  onAllLanded={(results, total) => {
    console.log('Rolled:', results, '— Total:', total)
  }}
/>
```

**Transparent panel over a custom background**
```tsx
<div style={{ background: 'url(/my-table.png)' }}>
  <DicePanel
    transparent
    diceCount={3}
    onDieLanded={(index, value) => console.log(index, value)}
    onAllLanded={(results, total) => applyRollToGame(results, total)}
  />
</div>
```

**Variable dice, add button enabled (default behaviour)**
```tsx
<DicePanel
  diceCount={3}
  onAllLanded={(results, total) => applyRollToGame(results, total)}
/>
```

> **Note:** Changing `diceCount` after mount resets the panel (clears results and reinitialises the dice). If you want a fixed number of dice for the whole session, pass the value once and set `showAddButton={false}`.

## Stack

- React 19
- TypeScript
- Vite
- CSS Modules

## Dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
