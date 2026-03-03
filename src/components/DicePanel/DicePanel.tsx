import { useCallback, useEffect, useRef, useState } from 'react'
import { CoinDice, COAST_MIN, COAST_MAX, MAX_HOLD_MS } from '../Dice/CoinDice'
import styles from './DicePanel.module.css'

export interface DicePanelProps {
  /**
   * Number of dice to start with. Defaults to 1.
   * When `showAddButton` is false this is the fixed count for the whole session.
   */
  diceCount?: number
  /**
   * Whether to render the + button that lets the player add more dice.
   * Defaults to true.
   */
  showAddButton?: boolean
  /**
   * Called each time an individual die lands.
   * `index` is the 0-based position of the die in the panel (order added);
   * `value` is the result (1–6).
   */
  onDieLanded?: (index: number, value: number) => void
  /**
   * Called once all dice in a roll have landed.
   * `results` is one value per die (in the order they were added),
   * `total` is their sum.
   */
  onAllLanded?: (results: number[], total: number) => void
  /**
   * When true the panel background, border and box-shadow are removed so the
   * component can be placed directly over a custom game UI.
   */
  transparent?: boolean
  /**
   * Array of predetermined outcomes for each die (1-6). 
   * Used for multiplayer sync - spectators receive the roller's results.
   */
  targetValues?: number[]
  /**
   * When true, the panel becomes view-only (no user interaction).
   * Use for spectator mode in multiplayer.
   */
  disabled?: boolean
  /**
   * External press control - when provided, overrides internal press handling.
   */
  externalPressing?: boolean
  /**
   * External press start time control.
   */
  externalPressStart?: number
  /**
   * Hold duration in milliseconds for cross-device sync.
   * Send from roller to spectators to ensure identical timing.
   */
  holdDuration?: number
  /**
   * Called when user starts pressing (for controlling other panels).
   */
  onPressStart?: (timestamp: number) => void
  /**
   * Called when user stops pressing (for controlling other panels).
   * Also receives the scheduled settle timestamp and per-die coast distances
   * so they can be forwarded over the network to all spectator panels.
   */
  onPressEnd?: (holdDuration: number, settleAt: number, extraRotations: number[]) => void
  /**
   * Absolute wall-clock timestamp (Date.now()) at which ALL dice in this panel
   * should begin decelerating. Pass the value received from the roller's
   * onPressEnd to keep spectator panels perfectly in sync.
   */
  settleAt?: number
  /**
   * Per-die coast distances in degrees, one entry per die in panel order.
   * Pass the value received from the roller's onPressEnd so every client
   * coasts the same arc and therefore lands at the same moment.
   */
  extraRotations?: number[]
  /**
   * How many milliseconds into the future the roller schedules settling.
   * Must be ≥ the worst-case one-way network delay so spectators always
   * receive the settle message before the deadline. Defaults to 1000 ms.
   */
  networkBuffer?: number
  /**
   * When true, shows a "Total" label inside the panel after all dice have landed.
   * Defaults to false.
   */
  showTotal?: boolean
}

let nextId = 1

function makeIds(count: number): number[] {
  const ids: number[] = []
  for (let i = 0; i < count; i++) ids.push(nextId++)
  return ids
}

export function DicePanel({
  diceCount = 1,
  showAddButton = true,
  onDieLanded,
  onAllLanded,
  transparent = false,
  targetValues,
  disabled = false,
  externalPressing,
  externalPressStart,
  holdDuration,
  onPressStart,
  onPressEnd,
  showTotal = false,
  settleAt,
  extraRotations,
  networkBuffer = 1000,
}: DicePanelProps) {
  const [dice, setDice]                   = useState<number[]>(() => makeIds(diceCount))
  const [results, setResults]             = useState<Record<number, number | null>>({})
  const [pressing, setPressing]           = useState(false)
  const [settling, setSettling]           = useState(false)
  const [localSettleAt, setLocalSettleAt] = useState<number | undefined>(undefined)
  const [localExtraRotations, setLocalExtraRotations] = useState<number[] | undefined>(undefined)

  const pressStartRef = useRef<number>(0)
  const diceRef       = useRef<number[]>([])
  const rollDiceRef   = useRef<number[]>([])
  diceRef.current     = dice

  // Use external press state if provided (for synchronized spectator mode)
  const effectivePressing = externalPressing ?? pressing
  const effectivePressStart = externalPressStart ?? pressStartRef.current

  // Re-initialise when diceCount prop changes
  useEffect(() => {
    const ids = makeIds(diceCount)
    setDice(ids)
    setResults({})
    setPressing(false)
    setSettling(false)
    setLocalSettleAt(undefined)
    setLocalExtraRotations(undefined)
  // Only re-run when diceCount changes — ignore function-identity churn
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diceCount])

  const addDie = () => {
    const id = nextId++
    setDice(prev => [...prev, id])
    setResults(prev => ({ ...prev, [id]: null }))
  }

  const handlePressStart = useCallback(() => {
    if (settling) return
    pressStartRef.current = Date.now()
    rollDiceRef.current   = diceRef.current.slice()
    setResults({})
    setLocalSettleAt(undefined)
    setLocalExtraRotations(undefined)
    setPressing(true)
    onPressStart?.(pressStartRef.current)
  }, [settling, onPressStart])

  const handlePressEnd = useCallback(() => {
    if (!pressing) return
    const duration  = Date.now() - pressStartRef.current
    const scheduleAt = Date.now() + networkBuffer

    // Pre-compute per-die coast distances using the same formula as CoinDice so
    // we can send them to spectators and guarantee identical animation arcs.
    const t         = Math.min(duration / MAX_HOLD_MS, 1)
    const baseCoast = COAST_MIN + t * (COAST_MAX - COAST_MIN)
    const rotations = rollDiceRef.current.map(() => baseCoast * (0.85 + Math.random() * 0.3))

    setLocalSettleAt(scheduleAt)
    setLocalExtraRotations(rotations)
    setSettling(true)
    setPressing(false)
    onPressEnd?.(duration, scheduleAt, rotations)
  }, [pressing, onPressEnd, networkBuffer])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Prevent the browser from firing synthetic mouse events (mousedown/mouseleave)
    // which can interfere with press tracking on mobile.
    e.preventDefault()
    handlePressStart()
  }, [handlePressStart])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    handlePressEnd()
  }, [handlePressEnd])

  const handleResult = useCallback((id: number, value: number) => {
    setResults(prev => ({ ...prev, [id]: value }))
    if (onDieLanded) {
      const index = diceRef.current.indexOf(id)
      if (index !== -1) onDieLanded(index, value)
    }
  }, [onDieLanded])

  const landedCount = dice.filter(id => results[id] != null).length
  const allLanded   = dice.length > 0 && landedCount === dice.length

  // Unlock settling once every die in this roll has reported a result
  useEffect(() => {
    if (!settling) return
    if (rollDiceRef.current.every(id => results[id] != null)) {
      setSettling(false)

      if (onAllLanded) {
        const values = rollDiceRef.current.map(id => results[id] as number)
        const total  = values.reduce((s, v) => s + v, 0)
        onAllLanded(values, total)
      }
    }
  }, [results, settling, onAllLanded])

  const total = allLanded && dice.length > 1
    ? dice.reduce((sum, id) => sum + (results[id] as number), 0)
    : null

  return (
    <div
      className={[
        styles.panel,
        settling ? styles.panelLocked : '',
        transparent ? styles.panelTransparent : '',
        disabled ? styles.panelDisabled : '',
      ].filter(Boolean).join(' ')}
      onMouseDown={disabled ? undefined : handlePressStart}
      onMouseUp={disabled ? undefined : handlePressEnd}
      onMouseLeave={disabled ? undefined : handlePressEnd}
      onTouchStart={disabled ? undefined : handleTouchStart}
      onTouchEnd={disabled ? undefined : handleTouchEnd}
      onTouchCancel={disabled ? undefined : handlePressEnd}
      style={disabled ? { cursor: 'default', userSelect: 'none' } : undefined}
    >
      <div className={styles.diceArea}>
        {dice.map((id, index) => (
          <CoinDice
            key={id}
            pressing={effectivePressing}
            pressStart={effectivePressStart}
            onResult={(v) => handleResult(id, v)}
            targetValue={targetValues?.[index]}
            holdDuration={holdDuration}
            settleAt={localSettleAt ?? settleAt}
            extraRotation={(localExtraRotations ?? extraRotations)?.[index]}
          />
        ))}
      </div>

      {/* Hint overlay */}
      <p className={`${styles.hint} ${effectivePressing ? styles.hintActive : ''}`}>
        {disabled
          ? (effectivePressing
              ? 'Rolling…'
              : allLanded
                ? 'Spectating'
                : 'Waiting for roll…')
          : (effectivePressing
              ? 'Release to roll…'
              : settling
                ? 'Rolling…'
                : allLanded
                  ? 'Hold to roll again'
                  : 'Hold to spin · Release to roll')}
      </p>

      {/* Total inside panel */}
      {showTotal && total !== null && (
        <div className={styles.total}>
          Total&nbsp;<span className={styles.totalNum}>{total}</span>
        </div>
      )}

      {/* Optional + button */}
      {showAddButton && (
        <button
          className={styles.addBtn}
          onClick={e => { e.stopPropagation(); addDie() }}
          onMouseDown={e => e.stopPropagation()}
          title="Add a die"
        >
          +
        </button>
      )}
    </div>
  )
}
