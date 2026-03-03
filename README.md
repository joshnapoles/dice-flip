# Dice Flip

A minimal, tactile dice flipper built with React + TypeScript + Vite.  
Designed to be embedded in other games as a library with **full multiplayer sync support**.

## Features

- 🎲 **Hold & Release** - Natural dice rolling with physics-based animation
- 🎮 **Multiplayer Ready** - Built-in support for predetermined outcomes (perfect for syncing rolls across devices)
- 🎨 **Customizable** - Transparent mode, callbacks, configurable dice count
- ⚡ **Performant** - Pure DOM manipulation for smooth 60fps animations
- 📦 **Zero Dependencies** - Just React (peer dependency)

## How it works

- **Hold** anywhere on the panel to spin all dice
- **Release** to let them coast to a random result
- While dice are coasting you cannot start a new roll — wait for them all to land
- Once every die has landed, the **Total** is shown (with 2+ dice)
- Press **+** (top-right corner) to add more dice (when enabled)

## Installation

```bash
npm install dice-flip
```

## Basic Usage

Import the component and its styles:

```tsx
import { DicePanel } from 'dice-flip'
import 'dice-flip/dist/index.css'
```

### Simple Example

```tsx
<DicePanel diceCount={2} showAddButton={false} />
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `diceCount` | `number` | `1` | Number of dice to start with. |
| `showAddButton` | `boolean` | `true` | Show or hide the **+** button that lets the player add more dice at runtime. |
| `transparent` | `boolean` | `false` | When `true`, removes the panel background, border and box-shadow — ideal for placing the component directly over a custom game UI. |
| `onDieLanded` | `(index: number, value: number) => void` | — | Called each time an individual die lands. `index` is the die's 0-based position in the panel; `value` is its result (1–6). |
| `onAllLanded` | `(results: number[], total: number) => void` | — | Called once every die in a roll has landed. `results` contains each die's value in order; `total` is their sum. |
| **Multiplayer Props** | | | |
| `targetValues` | `number[]` | — | Predetermined outcomes for each die (1-6). When set, dice land on these specific values. Perfect for spectators in multiplayer games. |
| `disabled` | `boolean` | `false` | When `true`, makes the panel view-only (no user interaction). Use for spectator mode. |
| `externalPressing` | `boolean` | — | External press control. Overrides internal press handling when provided. |
| `externalPressStart` | `number` | — | External press start timestamp for synchronized rolling. |
| `holdDuration` | `number` | — | Hold duration in milliseconds. Ensures spectators slow down at the same rate as the roller. |
| `onPressStart` | `(timestamp: number) => void` | — | Called when user starts pressing. Use to sync roll start across devices. |
| `onPressEnd` | `(holdDuration: number) => void` | — | Called when user releases with the hold duration. Send this to spectators for perfect timing sync. |

### Examples

#### Single die, no add button
```tsx
<DicePanel diceCount={1} showAddButton={false} />
```

#### Two dice with result callbacks
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

#### Transparent panel over custom background
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

## Multiplayer Synchronization

Perfect for online multiplayer games where one player rolls and others need to see the same results!

### How It Works

1. **Roller** generates random results when pressing starts and broadcasts them
2. **Spectators** receive the predetermined results and start rolling simultaneously
3. Dice smoothly animate toward their predetermined values during the settling phase
4. Both roller and spectators land on the same values at the same time

The physics animation ensures dice naturally slow down and land on the target value - no sudden switches or jarring transitions.

### Implementation

#### Roller Side (Active Player)

```tsx
function RollerDice() {
  return (
    <DicePanel
      diceCount={2}
      showAddButton={false}
      onPressStart={(timestamp) => {
        // Generate random results at press start
        const results = [
          Math.floor(Math.random() * 6) + 1,
          Math.floor(Math.random() * 6) + 1
        ]
        
        // Send to all spectators via WebSocket/network
        socket.emit('rollStart', {
          timestamp,
          targetValues: results
        })
      }}
      onPressEnd={(holdDuration) => {
        // Tell spectators when to release
        socket.emit('rollRelease', { holdDuration })
      }}
      onAllLanded={(results, total) => {
        console.log('Roller landed:', results, total)
      }}
    />
  )
}
```

#### Spectator Side (Watching Players)

```tsx
function SpectatorDice() {
  const [pressing, setPressing] = useState(false)
  const [pressStart, setPressStart] = useState(0)
  const [targetValues, setTargetValues] = useState<number[]>()
  const [holdDuration, setHoldDuration] = useState<number>()

  useEffect(() => {
    // Receive roll start from roller
    socket.on('rollStart', ({ timestamp, targetValues }) => {
      setTargetValues(targetValues)
      setPressStart(timestamp)
      setPressing(true)
    })

    // Receive release from roller
    socket.on('rollRelease', ({ holdDuration }) => {
      setHoldDuration(holdDuration)
      setPressing(false)
    })

    return () => {
      socket.off('rollStart')
      socket.off('rollRelease')
    }
  }, [])

  return (
    <DicePanel
      diceCount={2}
      showAddButton={false}
      disabled={true}  // Spectator can't interact
      targetValues={targetValues}
      externalPressing={pressing}
      externalPressStart={pressStart}
      holdDuration={holdDuration}
      onAllLanded={(results, total) => {
        console.log('Spectator saw:', results, total)
      }}
    />
  )
}
```

### Network Events

**Event 1: `rollStart`** (when roller presses)
```json
{
  "timestamp": 1234567890,
  "targetValues": [5, 2]
}
```

**Event 2: `rollRelease`** (when roller releases)
```json
{
  "holdDuration": 847
}
```

### Why It Works

- **Same Physics**: Both roller and spectator use identical animation timing
- **Predetermined Outcomes**: Spectator dice land on received `targetValues` instead of random faces
- **Hold Duration Sync**: The `holdDuration` ensures both dice slow down at exactly the same rate
- **Perfect Sync**: Even with network latency, the visual experience is synchronized because the animation is deterministic

> **Note:** The spectator's dice will appear to roll naturally - other players cannot tell that the outcome is predetermined!

## Advanced Usage

### Programmatic Rolling

You can trigger rolls programmatically by controlling the `externalPressing` prop:

```tsx
function ProgrammaticRoller() {
  const [pressing, setPressing] = useState(false)
  const [pressStart, setPressStart] = useState(0)
  
  const triggerRoll = () => {
    setPressStart(Date.now())
    setPressing(true)
    setTimeout(() => setPressing(false), 500) // Hold for 500ms
  }
  
  return (
    <>
      <button onClick={triggerRoll}>Roll Dice</button>
      <DicePanel
        diceCount={2}
        externalPressing={pressing}
        externalPressStart={pressStart}
      />
    </>
  )
}
```

### Custom Styling

Override CSS variables or use `transparent` mode for full control:

```css
/* Custom dice colors */
.my-dice-container {
  --dice-face-color: #1a1a1a;
  --dice-pip-color: #ffffff;
}
```

### Responsive Design

Dice automatically scale based on viewport size using CSS `clamp()` for optimal viewing on any screen. Multiple dice stay side-by-side and won't wrap vertically, ensuring a consistent horizontal layout.

## API Reference

### `DicePanel`

The main component for rendering one or more dice with hold-to-roll interaction.

### `CoinDice`

Low-level component for a single die. Use `DicePanel` in most cases, but `CoinDice` is exported if you need fine-grained control.

## Development

```bash
npm install
npm run dev     # Start development server
npm run build   # Build library for distribution
npm run lint    # Run ESLint
```

## License

MIT

## Credits

Built with React 19, TypeScript, and Vite.
