import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './CoinDice.module.css'
import {
  spinAngle,
  createSettlePlan,
  settleAngle,
  halfRotation,
  type SettlePlan,
} from '../../spinMath'

// ─── Pip helpers (pure DOM — no React re-renders during animation) ────────────

const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[34, 34], [66, 66]],
  3: [[34, 34], [50, 50], [66, 66]],
  4: [[34, 34], [66, 34], [34, 66], [66, 66]],
  5: [[34, 34], [66, 34], [50, 50], [34, 66], [66, 66]],
  6: [[34, 28], [66, 28], [34, 50], [66, 50], [34, 72], [66, 72]],
}

function makePipSVG(value: number): string {
  const pips = PIP_POSITIONS[value] ?? []
  const rects = pips
    .map(([cx, cy]) => `<rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" fill="#1a1a1a"/>`)
    .join('')
  return `<svg viewBox="0 0 100 100" class="${styles.pipSvg}">${rects}</svg>`
}

const IDLE_HTML = `<span class="${styles.idleLabel}">D6</span>`

function setFaceEl(el: HTMLDivElement | null, value: number | 'idle') {
  if (el) el.innerHTML = value === 'idle' ? IDLE_HTML : makePipSVG(value)
}

function randomFace(exclude?: number): number {
  let n: number
  do { n = Math.floor(Math.random() * 6) + 1 } while (n === exclude)
  return n
}

// ─── Main component ───────────────────────────────────────────────────────────
//
// Animation is time-based, not frame-based:
//   • Spin phase  → spinAngle(base, elapsed)     (open-ended, local-only)
//   • Settle phase → settleAngle(plan, elapsed)   (deterministic, syncable)
//   • Landed       → fixed angle                  (no animation)
//
// The RAF loop is purely a rendering pump — it reads the current time,
// computes the angle from a pure function, and sets the CSS transform.
// No per-frame velocity accumulation, no delta-time compensation.
//
// For multiplayer:  broadcast { targetValue, holdDuration } on release.
// Each client creates its own local SettlePlan — same result, similar timing,
// but anchored to its own current angle.

type Phase = 'idle' | 'spinning' | 'settling' | 'landed'

export interface CoinDiceProps {
  /** True while the user is holding; false when they release. */
  pressing: boolean
  /** Date.now() captured when pressing became true. */
  pressStart: number
  onResult?: (value: number) => void
  /**
   * Predetermined outcome (1–6). The dice will land on this value.
   * For multiplayer: the roller picks it, spectators receive it.
   */
  targetValue?: number
  /**
   * Hold duration in ms from the roller. Overrides local hold calculation
   * so spectators get similar settle timing.
   */
  holdDuration?: number
}

export function CoinDice({ pressing, pressStart, onResult, targetValue, holdDuration }: CoinDiceProps) {
  // ── React state (only these cause re-renders) ─────────────────────────────
  const [phase, setPhase]   = useState<Phase>('idle')
  const [result, setResult] = useState<number | null>(null)

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const coinRef        = useRef<HTMLDivElement>(null)
  const frontFaceElRef = useRef<HTMLDivElement>(null)
  const backFaceElRef  = useRef<HTMLDivElement>(null)

  // ── Animation refs (mutated inside RAF — no React re-renders) ─────────────
  const phaseRef       = useRef<Phase>('idle')
  const angleRef       = useRef(0)
  const rafRef         = useRef(0)
  const resultRef      = useRef<number | null>(null)

  // Spin-phase tracking
  const spinStartRef   = useRef(0)   // performance.now() at spin start
  const baseAngleRef   = useRef(0)   // angle when spin started

  // Settle-phase tracking
  const planRef        = useRef<SettlePlan | null>(null)
  const settleStartRef = useRef(0)   // performance.now() at settle start

  // Face tracking
  const frontFaceRef   = useRef(1)
  const backFaceRef    = useRef(4)
  const lastHalfRotRef = useRef(0)
  const facePinnedRef  = useRef(false) // true once target face is locked in

  // Stable callback ref (avoids stale closure in long-running RAF loop)
  const onResultRef    = useRef(onResult)
  onResultRef.current  = onResult

  const setCoinTransform = (deg: number) => {
    const el = coinRef.current
    if (!el) return
    el.style.transform = `rotateY(${deg}deg)`
  }

  const setPhaseSync = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  // ── RAF tick ──────────────────────────────────────────────────────────────
  // Reads current time → computes angle from pure math → sets transform.
  // No velocity accumulation.  No delta-time normalisation.  Fully deterministic
  // for the settle phase, tolerant of tab-switch / frame-drop for the spin phase.
  const tick = useCallback(() => {
    const now = performance.now()
    const ph  = phaseRef.current
    let angle = angleRef.current

    if (ph === 'spinning') {
      angle = spinAngle(baseAngleRef.current, now - spinStartRef.current)

    } else if (ph === 'settling') {
      const plan    = planRef.current!
      const elapsed = now - settleStartRef.current
      angle = settleAngle(plan, elapsed)

      // ── Check for landing ─────────────────────────────────────────────
      if (elapsed >= plan.durationMs) {
        angle = plan.endAngle
        angleRef.current = angle
        setCoinTransform(angle)

        frontFaceRef.current = plan.targetValue
        setFaceEl(frontFaceElRef.current, plan.targetValue)

        setPhaseSync('landed')
        resultRef.current = plan.targetValue
        setResult(plan.targetValue)
        onResultRef.current?.(plan.targetValue)
        return // stop RAF loop
      }

    } else {
      return // idle or landed — nothing to animate
    }

    angleRef.current = angle
    setCoinTransform(angle)

    // ── Face randomisation at half-rotation boundaries ──────────────────
    const halfRot = halfRotation(angle)
    if (halfRot !== lastHalfRotRef.current) {
      lastHalfRotRef.current = halfRot

      // During settle: pin front face to target in the last full rotation
      if (ph === 'settling' && !facePinnedRef.current) {
        const remaining = planRef.current!.endAngle - angle
        if (remaining <= 360) {
          frontFaceRef.current = planRef.current!.targetValue
          setFaceEl(frontFaceElRef.current, planRef.current!.targetValue)
          facePinnedRef.current = true
        }
      }

      if (!facePinnedRef.current) {
        if (halfRot % 2 === 1) {
          // Back now visible → randomise hidden front
          const next = randomFace(backFaceRef.current)
          frontFaceRef.current = next
          setFaceEl(frontFaceElRef.current, next)
        } else {
          // Front now visible → randomise hidden back
          const next = randomFace(frontFaceRef.current)
          backFaceRef.current = next
          setFaceEl(backFaceElRef.current, next)
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // ── React to external pressing signal ─────────────────────────────────────
  useEffect(() => {
    if (pressing) {
      // Don't interrupt an active settle
      if (phaseRef.current === 'settling') return

      cancelAnimationFrame(rafRef.current)
      planRef.current      = null
      facePinnedRef.current = false
      baseAngleRef.current   = angleRef.current
      spinStartRef.current   = performance.now()
      lastHalfRotRef.current = halfRotation(angleRef.current)

      setResult(null)
      resultRef.current = null

      const newBack = randomFace(frontFaceRef.current)
      backFaceRef.current = newBack
      setFaceEl(frontFaceElRef.current, frontFaceRef.current)
      setFaceEl(backFaceElRef.current, newBack)

      setPhaseSync('spinning')
      rafRef.current = requestAnimationFrame(tick)

    } else if (phaseRef.current === 'spinning') {
      // Release → build settle plan and begin deceleration.
      // Uses holdDuration prop when provided (multiplayer sync),
      // otherwise computes locally from pressStart.
      const holdMs = holdDuration ?? (Date.now() - pressStart)
      const plan   = createSettlePlan(angleRef.current, holdMs, targetValue)

      planRef.current        = plan
      settleStartRef.current = performance.now()
      facePinnedRef.current  = false

      setPhaseSync('settling')
      // RAF loop continues — next tick reads the 'settling' phase
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressing])

  // Cleanup on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // Sync face DOM when going back to idle (after mount / diceCount reset)
  useEffect(() => {
    if (phase === 'idle') setFaceEl(frontFaceElRef.current, 'idle')
  }, [phase])

  return (
    <div className={styles.root}>
      <div className={styles.scene}>
        <div className={styles.coinWrap}>
          <div ref={coinRef} className={styles.coin}>
            {/* Faces: content is written via setFaceEl (direct DOM), not React state */}
            <div ref={frontFaceElRef} className={`${styles.face} ${styles.faceFront}`} />
            <div ref={backFaceElRef}  className={`${styles.face} ${styles.faceBack}`} />

            {/* Thickness edges */}
            <div className={`${styles.edge} ${styles.edgeTop}`} />
            <div className={`${styles.edge} ${styles.edgeBottom}`} />
            <div className={`${styles.edge} ${styles.edgeLeft}`} />
            <div className={`${styles.edge} ${styles.edgeRight}`} />
          </div>
        </div>
      </div>

      {/* Small result badge inside tile */}
      {phase === 'landed' && result !== null && (
        <span className={styles.resultNum}>{result}</span>
      )}
    </div>
  )
}
